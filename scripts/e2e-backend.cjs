if (
  process.env.DB_HOST !== "127.0.0.1" ||
  process.env.DB_PORT !== "55432" ||
  process.env.DB_NAME !== "mapphayao_e2e" ||
  process.env.DB_SSL !== "false"
) {
  throw new Error("Refusing to run E2E against a non-local database");
}
process.env.GOOGLE_MIRROR_ENABLED = "false";

const { createApp } = require("../backend/src/server");
const { createLineController } = require("../backend/src/controllers/lineController");
const { createFakeGoogleParcels } = require("./fake-google-parcels.cjs");
const { createParcelCleanupWorker } = require("../backend/src/services/parcelCleanupWorker");
const photoOperations = require("../backend/src/services/parcelPhotoEditService");
const googleIntegration = createFakeGoogleParcels();
const cleanupWorker = createParcelCleanupWorker({ google: googleIntegration, photoOperations });

const identities = new Map([
  ["e2e-line-token-user-a", "U_E2E_USER_A"],
  ["e2e-line-token-user-b", "U_E2E_USER_B"],
]);
const lineTokenService = {
  async verifyIdToken(token) {
    const userId = identities.get(token);
    if (!userId) {
      const error = new Error("Invalid ID token");
      error.statusCode = 401;
      throw error;
    }
    return { sub: userId, userId, displayName: token.endsWith("user-a") ? "ผู้ใช้ทดสอบ A" : "ผู้ใช้ทดสอบ B" };
  },
};
const sentMessages = [];
const lineMessagingService = {
  async pushMessage(recipient, message) {
    sentMessages.push({ recipient, message });
    return { ok: true, status: "SENT" };
  },
};

global.fetch = async () => {
  throw new Error("E2E backend outbound network blocked");
};

const app = createApp({
  lineTokenService,
  googleIntegration,
  lineController: createLineController({
    lineTokenService,
    lineMessagingService,
    getPublicAppUrl: () => "https://mapphayao-e2e.invalid/",
  }),
  registerRoutes(testApp) {
    testApp.get("/__e2e__/messages", (req, res) => res.json(sentMessages));
    testApp.get("/__e2e__/google", (req, res) => res.json(googleIntegration.snapshot()));
    testApp.post("/__e2e__/dashboard/invalidate", (req, res) => {
      testApp.locals.dashboardService.invalidate();
      res.json({ ok: true });
    });
    testApp.post("/__e2e__/dashboard/prune", async (req, res) => {
      const { rows } = await require("../backend/src/config/database").query(
        "SELECT parcel_code FROM app.parcels",
      );
      googleIntegration.pruneDashboardRows(new Set(rows.map((row) => row.parcel_code)));
      testApp.locals.dashboardService.invalidate();
      res.json({ ok: true });
    });
    testApp.post("/__e2e__/dashboard/parcel-cells", (req, res) => {
      const changed = googleIntegration.setDashboardParcelCells(req.body?.code, req.body);
      if (changed) testApp.locals.dashboardService.invalidate();
      res.status(changed ? 200 : 404).json({ ok: changed });
    });
    testApp.post("/__e2e__/dashboard/photo", async (req, res) => {
      const count = req.body?.count ?? 1;
      const failIndex = req.body?.failIndex ?? null;
      if (!Number.isInteger(count) || count < 1 || count > 5 ||
        (failIndex !== null && (!Number.isInteger(failIndex) || failIndex < 0 || failIndex >= count))) {
        return res.status(400).json({ ok: false });
      }
      const changed = await googleIntegration.seedDashboardPhoto(req.body?.code, count, failIndex);
      if (changed) testApp.locals.dashboardService.invalidate();
      res.status(changed ? 200 : 404).json({ ok: changed });
    });
    testApp.post("/__e2e__/dashboard/seed", (req, res) => {
      const { suffix, crop, count } = req.body || {};
      if (!/^[a-f0-9]{8}$/.test(suffix) || typeof crop !== "string" ||
        !/^dashboard-perf-[a-f0-9]{8}$/.test(crop) || !Number.isInteger(count) || count < 1 || count > 120) {
        return res.status(400).json({ ok: false });
      }
      googleIntegration.seedDashboardRows({ suffix, crop, count });
      testApp.locals.dashboardService.invalidate();
      return res.json({ ok: true });
    });
    testApp.post("/__e2e__/cleanup/run", async (req, res, next) => {
      try { res.json({ processed: await cleanupWorker.runCycle() }); } catch (error) { next(error); }
    });
    testApp.post("/__e2e__/google/fail-next-upload", (req, res) => {
      googleIntegration.failNextUpload();
      res.json({ ok: true });
    });
    testApp.post("/__e2e__/google/fail-next-ambiguous-upload", (req, res) => {
      googleIntegration.failNextAmbiguousUpload();
      res.json({ ok: true });
    });
    testApp.post("/__e2e__/google/fail-next-replacement", (req, res) => {
      googleIntegration.failNextReplacement();
      res.json({ ok: true });
    });
    testApp.post("/__e2e__/google/fail-after-replacement", (req, res) => {
      googleIntegration.failAfterNextReplacement();
      res.json({ ok: true });
    });
    testApp.post("/__e2e__/google/fail-next-parcel-upsert", (req, res) => {
      googleIntegration.failNextParcelUpsert();
      res.json({ ok: true });
    });
    testApp.post("/__e2e__/google/fail-next-image-read", (req, res) => {
      googleIntegration.failNextImageRead();
      res.json({ ok: true });
    });
    testApp.post("/__e2e__/google/fail-next-parcel-delete", (req, res) => {
      googleIntegration.failNextParcelDelete();
      res.json({ ok: true });
    });
    testApp.post("/__e2e__/google/require-idle-pool", (req, res) => {
      googleIntegration.requireIdlePool(req.body?.enabled === true);
      res.json({ ok: true });
    });
  },
});
const server = app.listen(3100, "127.0.0.1", () => {
  console.log("E2E backend ready on 127.0.0.1:3100");
  if (process.env.MANUAL_SANDBOX_CLEANUP === "1") cleanupWorker.start();
});
process.on("SIGINT", () => { cleanupWorker.stop(); server.close(); });
process.on("SIGTERM", () => { cleanupWorker.stop(); server.close(); });

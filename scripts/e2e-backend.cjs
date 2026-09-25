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
const googleIntegration = createFakeGoogleParcels();
const cleanupWorker = createParcelCleanupWorker({ google: googleIntegration });

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
    testApp.post("/__e2e__/cleanup/run", async (req, res, next) => {
      try { res.json({ processed: await cleanupWorker.runCycle() }); } catch (error) { next(error); }
    });
    testApp.post("/__e2e__/google/fail-next-upload", (req, res) => {
      googleIntegration.failNextUpload();
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

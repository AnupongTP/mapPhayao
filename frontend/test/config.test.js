const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const LOCAL_API_BASE_URL = "http://localhost:3000/api";
const RENDER_API_BASE_URL = "https://mapphayao-backend.onrender.com/api";
const NETLIFY_FRONTEND_HOST = "mapphayaoliff.netlify.app";
const OLD_CLOUDFLARE_FRONTEND_HOST = [
  "rapidly-marijuana-harper-partly",
  "trycloudflare.com",
].join(".");
const OLD_CURRENT_CLOUDFLARE_FRONTEND_HOST = "dishes-prefix-revised-whom.trycloudflare.com";
const OBSOLETE_BACKEND_TUNNEL =
  "https://embedded-nextel-reservoir-strike.trycloudflare.com/api";
const ACTIVE_FRONTEND_RUNTIME_FILES = [
  "index.html",
  "js/config.js",
  "js/api.js",
  "js/liff-mode.js",
  "js/map.js",
  "liff/liff-config.js",
];

function createFrontendContext(hostname) {
  const calls = [];
  const context = {
    URLSearchParams,
    JSON,
    Error,
    TypeError,
    window: {
      location: { hostname },
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ success: true }),
      };
    },
  };

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/config.js"), "utf8"),
    context,
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../js/api.js"), "utf8"),
    context,
  );

  return {
    calls,
    AppConfig: context.window.AppConfig,
    MapApi: context.window.MapApi,
  };
}

test("localhost resolves to local backend API", () => {
  const { AppConfig } = createFrontendContext("localhost");

  assert.equal(AppConfig.apiBaseUrl, LOCAL_API_BASE_URL);
});

test("127.0.0.1 resolves to local backend API", () => {
  const { AppConfig } = createFrontendContext("127.0.0.1");

  assert.equal(AppConfig.apiBaseUrl, LOCAL_API_BASE_URL);
});

test("production Netlify frontend resolves to Render backend API", () => {
  const { AppConfig } = createFrontendContext(NETLIFY_FRONTEND_HOST);

  assert.equal(AppConfig.apiBaseUrl, RENDER_API_BASE_URL);
});

test("other production host resolves to Render backend API", () => {
  const { AppConfig } = createFrontendContext("www.example.com");

  assert.equal(AppConfig.apiBaseUrl, RENDER_API_BASE_URL);
});

test("active config source does not hardcode obsolete tunnels", () => {
  const configSource = fs.readFileSync(path.join(__dirname, "../js/config.js"), "utf8");

  assert.equal(configSource.includes(OBSOLETE_BACKEND_TUNNEL), false);
  assert.equal(configSource.includes(".trycloudflare.com"), false);
});

test("active frontend runtime source does not contain old Cloudflare frontend domain", () => {
  for (const relativePath of ACTIVE_FRONTEND_RUNTIME_FILES) {
    const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

    assert.equal(source.includes(OLD_CLOUDFLARE_FRONTEND_HOST), false, relativePath);
    assert.equal(source.includes(OLD_CURRENT_CLOUDFLARE_FRONTEND_HOST), false, relativePath);
  }
});

test("location-report URL contains exactly one /api segment", async () => {
  const { calls, MapApi } = createFrontendContext(NETLIFY_FRONTEND_HOST);

  await MapApi.getLocationReport(19.04212, 99.891977);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://mapphayao-backend.onrender.com/api/location-report?lat=19.04212&lng=99.891977",
  );
  assert.equal((calls[0].url.match(/\/api/g) || []).length, 1);
  assert.equal(calls[0].url.includes("/api/api/"), false);
});

test("Netlify config publishes only the active static frontend directory without a build command", () => {
  const netlifySource = fs.readFileSync(
    path.join(__dirname, "../../netlify.toml"),
    "utf8",
  );

  assert.match(netlifySource, /\[build\]/);
  assert.match(netlifySource, /publish\s*=\s*"frontend"/);
  assert.doesNotMatch(netlifySource, /command\s*=/);
  assert.doesNotMatch(netlifySource, /backend|database|db_export|backups|\.env/);
});

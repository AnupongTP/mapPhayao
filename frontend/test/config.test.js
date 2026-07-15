const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const LOCAL_API_BASE_URL = "http://localhost:3000/api";
const RENDER_API_BASE_URL = "https://mapphayao-backend.onrender.com/api";
const CLOUDFLARE_FRONTEND_HOST = "rapidly-marijuana-harper-partly.trycloudflare.com";
const OBSOLETE_BACKEND_TUNNEL =
  "https://embedded-nextel-reservoir-strike.trycloudflare.com/api";

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

test("current Cloudflare frontend resolves to Render backend API", () => {
  const { AppConfig } = createFrontendContext(CLOUDFLARE_FRONTEND_HOST);

  assert.equal(AppConfig.apiBaseUrl, RENDER_API_BASE_URL);
});

test("other production host resolves to Render backend API", () => {
  const { AppConfig } = createFrontendContext("www.example.com");

  assert.equal(AppConfig.apiBaseUrl, RENDER_API_BASE_URL);
});

test("active config source does not contain obsolete backend tunnel", () => {
  const configSource = fs.readFileSync(path.join(__dirname, "../js/config.js"), "utf8");

  assert.equal(configSource.includes(OBSOLETE_BACKEND_TUNNEL), false);
});

test("location-report URL contains exactly one /api segment", async () => {
  const { calls, MapApi } = createFrontendContext(CLOUDFLARE_FRONTEND_HOST);

  await MapApi.getLocationReport(19.04212, 99.891977);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://mapphayao-backend.onrender.com/api/location-report?lat=19.04212&lng=99.891977",
  );
  assert.equal((calls[0].url.match(/\/api/g) || []).length, 1);
  assert.equal(calls[0].url.includes("/api/api/"), false);
});

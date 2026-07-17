const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NETLIFY_FRONTEND_ORIGIN = "https://mapphayaoliff.netlify.app";
const OLD_FRONTEND_ORIGIN = "https://foreign-copper-provision-constitute.trycloudflare.com";

const serverSource = fs.readFileSync(
  path.join(__dirname, "../src/server.js"),
  "utf8",
);

test("repository CORS allowlist uses the permanent Netlify frontend origin", () => {
  assert.equal(serverSource.includes(NETLIFY_FRONTEND_ORIGIN), true);
  assert.equal(serverSource.includes(OLD_FRONTEND_ORIGIN), false);
  assert.match(serverSource, /process\.env\.CORS_ORIGINS/);
  assert.doesNotMatch(serverSource, /allowedOrigins[\s\S]*"\*"/);
  assert.match(serverSource, /allowedHeaders:\s*\["Content-Type", "Authorization"\]/);
  assert.match(serverSource, /Origin is not allowed by CORS/);
});

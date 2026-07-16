const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NEW_FRONTEND_ORIGIN = "https://dishes-prefix-revised-whom.trycloudflare.com";
const OLD_FRONTEND_ORIGIN = `https://${[
  "rapidly-marijuana-harper-partly",
  "trycloudflare.com",
].join(".")}`;

const serverSource = fs.readFileSync(
  path.join(__dirname, "../src/server.js"),
  "utf8",
);

test("repository CORS temporary tunnel allowlist uses the current frontend origin", () => {
  assert.equal(serverSource.includes(NEW_FRONTEND_ORIGIN), true);
  assert.equal(serverSource.includes(OLD_FRONTEND_ORIGIN), false);
  assert.match(serverSource, /process\.env\.CORS_ORIGINS/);
  assert.doesNotMatch(serverSource, /allowedOrigins[\s\S]*"\*"/);
});

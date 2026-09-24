const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: "test-results",
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  forbidOnly: true,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
});

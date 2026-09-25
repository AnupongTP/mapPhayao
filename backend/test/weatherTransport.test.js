const test = require("node:test");
const assert = require("node:assert/strict");
const weatherService = require("../src/services/weatherService");

const point = { latitude: 19.02, longitude: 99.97 };
const other = { latitude: 19.03, longitude: 99.98 };
const body = {
  utc_offset_seconds: 25200,
  current: { time: "2026-07-15T00:00", temperature_2m: 28.5 },
  hourly: { time: ["2026-07-15T00:00", "2026-07-15T01:00"],
    precipitation_probability: [15, 82] },
};
const local = { isInsidePhayao: async () => true };

test.afterEach(() => weatherService.clearCache());

test("transport must be explicit; missing or unknown mode never uses direct fetch", async () => {
  let calls = 0;
  const logs = [];
  const original = console.warn;
  console.warn = (...args) => logs.push(args);
  try {
    for (const value of [undefined, "unknown"]) {
      const result = await weatherService.getWeatherForLocation(point, {
        ...local, env: { WEATHER_OPEN_METEO_TRANSPORT: value },
        fetchImpl: async () => { calls++; throw new Error("direct must not run"); },
      });
      assert.equal(result.status, "UNAVAILABLE");
    }
    assert.equal(calls, 0);
    assert.deepEqual(logs.map((item) => item[1]), [{ stage: "config" }, { stage: "config" }]);
  } finally { console.warn = original; }
});

test("explicit direct transport remains available with existing normalization", async () => {
  let calls = 0;
  const result = await weatherService.getWeatherForLocation(point, { ...local,
    env: { WEATHER_OPEN_METEO_TRANSPORT: "direct" },
    fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => body }; },
  });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.temperatureC, 28.5);
  assert.equal(result.nextHourPrecipitationProbabilityPercent, 82);
  assert.equal(calls, 1);
});

test("Apps Script transport feeds existing normalization and AVAILABLE cache without direct fetch", async () => {
  let calls = 0;
  const options = { ...local, env: { WEATHER_OPEN_METEO_TRANSPORT: "apps-script" },
    fetchImpl: async () => { throw new Error("direct must not run"); },
    appsScriptBridge: { async getWeather(latitude, longitude) {
      calls++;
      assert.deepEqual([latitude, longitude], [point.latitude, point.longitude]);
      return { success: true, providerStatus: 200, body };
    } } };
  const first = await weatherService.getWeatherForLocation(point, options);
  const cached = await weatherService.getWeatherForLocation(point, options);
  assert.equal(first.status, "AVAILABLE");
  assert.equal(first.temperatureC, 28.5);
  assert.equal(first.nextHourPrecipitationProbabilityPercent, 82);
  assert.deepEqual(cached, first);
  assert.equal(calls, 1);
});

test("Apps Script provider 429 starts global cooldown and honors Retry-After bounds", async () => {
  let time = 100000;
  let calls = 0;
  const logs = [];
  const original = console.warn;
  console.warn = (...args) => logs.push(args);
  try {
    const options = { ...local, now: () => time,
      env: { WEATHER_OPEN_METEO_TRANSPORT: "apps-script" },
      appsScriptBridge: { async getWeather() {
        calls++;
        return calls === 1 ? { success: true, providerStatus: 429, retryAfter: "120", body: null }
          : { success: true, providerStatus: 200, body };
      } } };
    assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "UNAVAILABLE");
    assert.deepEqual(logs[0], ["weather-provider-unavailable", {
      stage: "rate-limit", status: 429, retryAfterSeconds: 120,
    }]);
    assert.equal((await weatherService.getWeatherForLocation(other, options)).status, "UNAVAILABLE");
    assert.equal(calls, 1);
    time += 120000;
    assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "AVAILABLE");
    assert.equal(calls, 2);
    assert.equal(JSON.stringify(logs).includes("19.02"), false);
  } finally { console.warn = original; }
});

test("Apps Script 429 Retry-After date, missing, and excessive values keep safe cooldowns", async () => {
  const original = console.warn;
  const logs = [];
  console.warn = (...args) => logs.push(args);
  try {
    for (const [retryAfter, expected] of [
      [new Date(190000).toUTCString(), 90], [null, 60], ["broken", 60], ["99999", 300],
    ]) {
      weatherService.clearCache();
      const result = await weatherService.getWeatherForLocation(point, { ...local, now: () => 100000,
        env: { WEATHER_OPEN_METEO_TRANSPORT: "apps-script" },
        appsScriptBridge: { async getWeather() { return { providerStatus: 429, retryAfter }; } },
      });
      assert.equal(result.status, "UNAVAILABLE");
      assert.equal(logs.at(-1)[1].retryAfterSeconds, expected);
    }
  } finally { console.warn = original; }
});

test("cached AVAILABLE result survives later Apps Script cooldown", async () => {
  let time = 100000;
  let calls = 0;
  const original = console.warn;
  console.warn = () => {};
  try {
    const options = { ...local, now: () => time,
      env: { WEATHER_OPEN_METEO_TRANSPORT: "apps-script" },
      appsScriptBridge: { async getWeather() {
        calls++;
        return calls === 1 ? { providerStatus: 200, body } :
          { providerStatus: 429, retryAfter: "60" };
      } } };
    assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "AVAILABLE");
    assert.equal((await weatherService.getWeatherForLocation(other, options)).status, "UNAVAILABLE");
    assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "AVAILABLE");
    assert.equal(calls, 2);
    time += 60000;
    assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "AVAILABLE");
  } finally { console.warn = original; }
});

test("Apps Script same-location requests deduplicate and failures do not poison later calls", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const options = { ...local, env: { WEATHER_OPEN_METEO_TRANSPORT: "apps-script" },
    appsScriptBridge: { async getWeather() { calls++; await gate; return { providerStatus: 200, body }; } } };
  const first = weatherService.getWeatherForLocation(point, options);
  const second = weatherService.getWeatherForLocation({ latitude: 19.020001, longitude: 99.970001 }, options);
  release();
  assert.equal((await first).status, "AVAILABLE");
  assert.equal((await second).status, "AVAILABLE");
  assert.equal(calls, 1);
  weatherService.clearCache();
  const original = console.warn;
  console.warn = () => {};
  try {
    const failing = { ...local, env: { WEATHER_OPEN_METEO_TRANSPORT: "apps-script" },
      appsScriptBridge: { async getWeather() {
        calls++;
        throw Object.assign(new Error("secret=PRIVATE lat=19.02"), { bridgeCategory: "network" });
      } } };
    const results = await Promise.all([
      weatherService.getWeatherForLocation(point, failing),
      weatherService.getWeatherForLocation(point, failing),
    ]);
    assert.deepEqual(results.map((item) => item.status), ["UNAVAILABLE", "UNAVAILABLE"]);
    assert.equal(calls, 2);
    await weatherService.getWeatherForLocation(point, failing);
    assert.equal(calls, 3);
  } finally { console.warn = original; }
});

test("Apps Script network, rejected, and invalid responses stay sanitized with no fallback", async () => {
  const original = console.warn;
  const logs = [];
  console.warn = (...args) => logs.push(args);
  let directCalls = 0;
  try {
    for (const [category, stage] of [
      ["network", "apps-script-network"], ["timeout", "apps-script-timeout"],
      ["rejected", "apps-script-rejected"], ["invalid-response", "apps-script-invalid-response"],
    ]) {
      await weatherService.getWeatherForLocation(point, { ...local,
        env: { WEATHER_OPEN_METEO_TRANSPORT: "apps-script" },
        fetchImpl: async () => { directCalls++; throw new Error("direct should not run"); },
        appsScriptBridge: { async getWeather() {
          throw Object.assign(new Error("SECRET signature=PRIVATE longitude=99.97"),
            { bridgeCategory: category });
        } },
      });
      assert.deepEqual(logs.at(-1), ["weather-provider-unavailable", { stage }]);
    }
    assert.equal(directCalls, 0);
    assert.equal(JSON.stringify(logs).includes("SECRET"), false);
    assert.equal(JSON.stringify(logs).includes("99.97"), false);
  } finally { console.warn = original; }
});

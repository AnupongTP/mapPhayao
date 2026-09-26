const test = require("node:test");
const assert = require("node:assert/strict");
const weatherService = require("../src/services/weatherService");

const point = { latitude: 19.02, longitude: 99.97 };
const local = { isInsidePhayao: async () => true };
const key = "FAKE_WEATHER_KEY_12345";
const epoch = (iso) => Date.parse(iso) / 1000;

function weatherBody(localTime = "2026-07-14T17:30:00Z") {
  const current = epoch(localTime);
  return {
    location: { tz_id: "Asia/Bangkok", localtime_epoch: current },
    current: { temp_c: 28.5, last_updated_epoch: current - 900 },
    forecast: { forecastday: [
      { hour: [
        { time_epoch: epoch("2026-07-14T17:00:00Z"), chance_of_rain: 15 },
        { time_epoch: epoch("2026-07-14T18:00:00Z"), chance_of_rain: 82 },
      ] },
      { hour: [{ time_epoch: epoch("2026-07-14T19:00:00Z"), chance_of_rain: 35 }] },
    ] },
  };
}

function response(status, body, retryAfter) {
  return { status, headers: { get: () => retryAfter ?? null }, json: async () => body };
}

test.afterEach(() => weatherService.clearCache());

test("WeatherAPI HTTPS request uses only the backend key, required fields and no redirects", async () => {
  let calls = 0;
  const result = await weatherService.getWeatherForLocation(point, { ...local,
    env: { WEATHER_API_KEY: key, WEATHER_OPEN_METEO_TRANSPORT: "apps-script" },
    appsScriptBridge: { getWeather() { throw new Error("Apps Script must not run"); } },
    fetchImpl: async (target, options) => {
      calls++;
      const url = new URL(target);
      assert.equal(url.origin + url.pathname, weatherService.WEATHERAPI_BASE_URL);
      assert.equal(url.protocol, "https:");
      assert.equal(url.searchParams.get("key"), key);
      assert.equal(url.searchParams.get("q"), "19.02,99.97");
      assert.equal(url.searchParams.get("days"), "2");
      assert.equal(url.searchParams.get("current_fields"), "temp_c,last_updated_epoch");
      assert.equal(url.searchParams.get("hour_fields"), "time_epoch,chance_of_rain");
      assert.equal(url.searchParams.get("aqi"), "no");
      assert.equal(url.searchParams.get("alerts"), "no");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Accept, "application/json");
      return response(200, weatherBody());
    },
  });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.source, "WeatherAPI");
  assert.equal(calls, 1);
});

test("AVAILABLE cache lasts 60 minutes and expires without caching failures", async () => {
  assert.equal(weatherService.CACHE_TTL_MS, 60 * 60 * 1000);
  let time = 100000;
  let calls = 0;
  const options = { ...local, env: { WEATHER_API_KEY: key }, now: () => time,
    fetchImpl: async () => { calls++; return response(200, weatherBody()); } };
  assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "AVAILABLE");
  time += 60 * 60 * 1000 - 1;
  assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "AVAILABLE");
  assert.equal(calls, 1);
  time += 1;
  assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "AVAILABLE");
  assert.equal(calls, 2);
  weatherService.clearCache();
  const original = console.warn;
  console.warn = () => {};
  try {
    const failing = { ...options, fetchImpl: async () => { calls++; return response(503); } };
    assert.equal((await weatherService.getWeatherForLocation(point, failing)).status, "UNAVAILABLE");
    assert.equal((await weatherService.getWeatherForLocation(point, failing)).status, "UNAVAILABLE");
    assert.equal(calls, 4);
  } finally { console.warn = original; }
});

test("same-location concurrent requests share one WeatherAPI fetch", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const options = { ...local, env: { WEATHER_API_KEY: key },
    fetchImpl: async () => { calls++; await gate; return response(200, weatherBody()); } };
  const first = weatherService.getWeatherForLocation(point, options);
  const second = weatherService.getWeatherForLocation(
    { latitude: 19.020001, longitude: 99.970001 }, options);
  release();
  assert.deepEqual((await Promise.all([first, second])).map((item) => item.status),
    ["AVAILABLE", "AVAILABLE"]);
  assert.equal(calls, 1);
});

test("429 uses bounded Retry-After cooldown across locations", async () => {
  let time = 100000;
  let calls = 0;
  const logs = [];
  const original = console.warn;
  console.warn = (...args) => logs.push(args);
  try {
    const options = { ...local, env: { WEATHER_API_KEY: key }, now: () => time,
      fetchImpl: async () => {
        calls++;
        return calls === 1 ? response(429, null, "120") : response(200, weatherBody());
      } };
    assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "UNAVAILABLE");
    assert.deepEqual(logs[0], ["weather-provider-unavailable",
      { stage: "rate-limit", status: 429, retryAfterSeconds: 120 }]);
    assert.equal((await weatherService.getWeatherForLocation(
      { latitude: 19.03, longitude: 99.98 }, options)).status, "UNAVAILABLE");
    assert.equal(calls, 1);
    time += 120000;
    assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "AVAILABLE");
    assert.equal(calls, 2);
    assert.deepEqual([null, "broken", "999999"].map((value) =>
      weatherService._private.retryAfterSeconds(value, time)), [60, 60, 300]);
  } finally { console.warn = original; }
});

test("HTTP-date Retry-After sets the correct bounded cooldown", async () => {
  let time = Date.parse("2026-07-15T00:00:00Z");
  let calls = 0;
  const logs = [];
  const original = console.warn;
  console.warn = (...args) => logs.push(args);
  try {
    const retryAfter = new Date(time + 90000).toUTCString();
    const options = { ...local, env: { WEATHER_API_KEY: key }, now: () => time,
      fetchImpl: async () => {
        calls++;
        return calls === 1 ? response(429, null, retryAfter) : response(200, weatherBody());
      } };
    assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "UNAVAILABLE");
    assert.deepEqual(logs[0], ["weather-provider-unavailable",
      { stage: "rate-limit", status: 429, retryAfterSeconds: 90 }]);
    time += 89000;
    assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "UNAVAILABLE");
    assert.equal(calls, 1);
    time += 1000;
    assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "AVAILABLE");
    assert.equal(calls, 2);
    assert.deepEqual(["invalid", "999999"].map((value) =>
      weatherService._private.retryAfterSeconds(value, time)), [60, 300]);
  } finally { console.warn = original; }
});

test("cached AVAILABLE weather remains visible during a global 429 cooldown", async () => {
  let time = 100000;
  let calls = 0;
  const original = console.warn;
  console.warn = () => {};
  try {
    const options = { ...local, env: { WEATHER_API_KEY: key }, now: () => time,
      fetchImpl: async () => {
        calls++;
        return calls === 1 ? response(200, weatherBody()) : response(429, null, "120");
      } };
    const cached = await weatherService.getWeatherForLocation(point, options);
    assert.equal(cached.status, "AVAILABLE");
    assert.equal((await weatherService.getWeatherForLocation(
      { latitude: 19.03, longitude: 99.98 }, options)).status, "UNAVAILABLE");
    time += 60000;
    assert.deepEqual(await weatherService.getWeatherForLocation(point, options), cached);
    assert.equal(calls, 2);
  } finally { console.warn = original; }
});

test("failed same-location in-flight request clears so a later request fetches again", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const original = console.warn;
  console.warn = () => {};
  try {
    const options = { ...local, env: { WEATHER_API_KEY: key },
      fetchImpl: async () => {
        calls++;
        if (calls === 1) {
          await gate;
          return response(503);
        }
        return response(200, weatherBody());
      } };
    const first = weatherService.getWeatherForLocation(point, options);
    const concurrent = weatherService.getWeatherForLocation(
      { latitude: 19.020001, longitude: 99.970001 }, options);
    release();
    assert.deepEqual((await Promise.all([first, concurrent])).map((item) => item.status),
      ["UNAVAILABLE", "UNAVAILABLE"]);
    assert.equal(calls, 1);
    assert.equal((await weatherService.getWeatherForLocation(point, options)).status, "AVAILABLE");
    assert.equal(calls, 2);
  } finally { console.warn = original; }
});

test("missing or malformed key fails closed without calling a provider", async () => {
  let calls = 0;
  const logs = [];
  const original = console.warn;
  console.warn = (...args) => logs.push(args);
  try {
    for (const candidate of [undefined, "", "bad key", "short"]) {
      const result = await weatherService.getWeatherForLocation(point, { ...local,
        env: { WEATHER_API_KEY: candidate },
        fetchImpl: async () => { calls++; throw new Error("must not run"); },
      });
      assert.equal(result.status, "UNAVAILABLE");
      assert.equal(result.source, "WeatherAPI");
    }
    assert.equal(calls, 0);
    assert.deepEqual(logs.map((entry) => entry[1]), Array(4).fill({ stage: "config" }));
  } finally { console.warn = original; }
});

test("HTTP, network, timeout, JSON and payload failures return sanitized UNAVAILABLE", async () => {
  const logs = [];
  const original = console.warn;
  console.warn = (...args) => logs.push(args);
  try {
    for (const [fetchImpl, expected] of [
      [async () => response(400, { secret: key }), { stage: "bad-request", status: 400 }],
      [async () => response(401, { secret: key }), { stage: "auth", status: 401 }],
      [async () => response(403, { secret: key }), { stage: "auth", status: 403 }],
      [async () => response(503, { secret: key }), { stage: "upstream", status: 503 }],
      [async () => { throw new Error("URL contains " + key); }, { stage: "network" }],
      [async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error(key)), { once: true });
      }), { stage: "timeout" }],
      [async () => ({ status: 200, json: async () => { throw new Error(key); } }), { stage: "invalid-json" }],
      [async () => response(200, { current: { temp_c: 30 } }), { stage: "invalid-payload" }],
    ]) {
      weatherService.clearCache();
      const result = await weatherService.getWeatherForLocation(point, { ...local,
        env: { WEATHER_API_KEY: key }, timeoutMs: 5, fetchImpl });
      assert.equal(result.status, "UNAVAILABLE");
      assert.deepEqual(logs.at(-1), ["weather-provider-unavailable", expected]);
    }
    assert.doesNotMatch(JSON.stringify(logs), new RegExp(key));
    assert.doesNotMatch(JSON.stringify(logs), /19\.02|99\.97/);
  } finally { console.warn = original; }
});

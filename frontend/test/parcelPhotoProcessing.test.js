const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/parcel-photo-processing.js"), "utf8");

function harness(options = {}) {
  const drawn = [];
  const encoded = [];
  const revoked = [];
  const logs = [];
  const window = { MapApi: { uploadParcelImage: options.upload || (async () => ({ id: "saved.webp" })) },
    console: {
      info: (...args) => logs.push({ level: "info", args }),
      error: (...args) => logs.push({ level: "error", args }),
      warn: (...args) => logs.push({ level: "warn", args }),
    },
  };
  class FakeImage {
    naturalWidth = options.width ?? 3200;
    naturalHeight = options.height ?? 1600;
    set src(value) {
      this.url = value;
      queueMicrotask(() => options.decodeFails ? this.onerror() : this.onload());
    }
  }
  const document = { createElement(name) {
    assert.equal(name, "canvas");
    return {
      getContext() {
        if (options.noContext) return null;
        return { drawImage(_image, _x, _y, width, height) { drawn.push({ width, height }); } };
      },
      toBlob(callback, type, quality) {
        encoded.push({ type, quality, width: this.width, height: this.height });
        const outputType = options.unsupportedWebp && type === "image/webp" ? "image/png" : type;
        callback(new Blob([Buffer.alloc(options.outputBytes ?? 100)], { type: outputType }));
      },
    };
  } };
  vm.runInNewContext(source, { window, document, Image: FakeImage, File, URL: {
    createObjectURL: () => "blob:source", revokeObjectURL: (url) => revoked.push(url),
  } });
  return { ...window.MapParcelPhotoProcessing, drawn, encoded, revoked, logs };
}

function input(name = "camera.jpg", type = "image/jpeg", size = 1000) {
  return new File([Buffer.alloc(size)], name, { type });
}

test("large mobile photo is oriented by browser image decoding and resized without distortion", async () => {
  const client = harness();
  const output = await client.prepareFile(input());
  assert.notEqual(output.name, "camera.jpg");
  assert.equal(output.name, "camera.webp");
  assert.equal(output.type, "image/webp");
  assert.deepEqual(client.drawn, [{ width: 1600, height: 800 }]);
  assert.deepEqual(client.encoded, [{ type: "image/webp", quality: 0.8, width: 1600, height: 800 }]);
  assert.deepEqual(client.revoked, ["blob:source"]);
});

test("small photo is not enlarged and HEIC may use JPEG encoding fallback", async () => {
  const client = harness({ width: 600, height: 900, unsupportedWebp: true });
  const output = await client.prepareFile(input("camera.heic", "image/heic"));
  assert.deepEqual(client.drawn, [{ width: 600, height: 900 }]);
  assert.equal(output.name, "camera.jpg");
  assert.equal(output.type, "image/jpeg");
});

test("PNG without WebP encoder, decode failure, and larger output preserve original File", async () => {
  const png = input("transparent.png", "image/png");
  const unavailable = harness({ unsupportedWebp: true });
  assert.equal(await unavailable.prepareFile(png), png);
  assert.deepEqual(unavailable.revoked, ["blob:source"]);
  const broken = harness({ decodeFails: true });
  const undecodable = input();
  assert.equal(await broken.prepareFile(undecodable), undecodable);
  assert.deepEqual(broken.revoked, ["blob:source"]);
  const large = harness({ outputBytes: 2000 });
  const original = input();
  assert.equal(await large.prepareFile(original), original);
});

test("safe transient retries reuse one prepared file and stable photo ID with bounded delays", async () => {
  const calls = [];
  const delays = [];
  const progress = [];
  const client = harness({ upload: async (parcelId, file, photoId, options) => {
    calls.push({ parcelId, file, photoId, attempt: options.attempt });
    if (options.attempt < 3) throw Object.assign(new Error("transient"), { retryable: true });
    return { id: "saved.webp" };
  } });
  const photo = { file: input(), clientPhotoId: "stable-id" };
  const result = await client.uploadWithRetry(photo, "parcel-id", 2, 5, (message) => progress.push(message),
    { wait: async (ms) => delays.push(ms) });
  assert.equal(result.id, "saved.webp");
  assert.deepEqual(calls.map((call) => call.attempt), [0, 1, 2, 3]);
  assert.deepEqual(delays, [500, 1000, 2000]);
  assert.equal(new Set(calls.map((call) => call.file)).size, 1);
  assert.deepEqual(calls.map((call) => call.photoId), Array(4).fill("stable-id"));
  assert.deepEqual(calls.map((call) => call.parcelId), Array(4).fill("parcel-id"));
  assert.deepEqual(progress.filter((message) => message.includes("อีกครั้ง")), [
    "กำลังลองอัปโหลดรูป 2/5 อีกครั้ง... (1/3)",
    "กำลังลองอัปโหลดรูป 2/5 อีกครั้ง... (2/3)",
    "กำลังลองอัปโหลดรูป 2/5 อีกครั้ง... (3/3)",
  ]);
  assert.equal(photo.clientPhotoId, "stable-id");
  await client.uploadWithRetry(photo, "parcel-id", 2, 5, () => {});
  assert.equal(calls.length, 4);
});

test("four safe transient failures stop after exactly three automatic retries", async () => {
  const calls = [];
  const client = harness({ upload: async (_parcelId, _file, _photoId, options) => {
    calls.push(options.attempt);
    throw Object.assign(new Error("transient"), { retryable: true });
  } });
  const delays = [];
  await assert.rejects(() => client.uploadWithRetry({ file: input(), clientPhotoId: "id" },
    "parcel", 1, 1, () => {}, { wait: async (ms) => delays.push(ms) }), /transient/);
  assert.deepEqual(calls, [0, 1, 2, 3]);
  assert.deepEqual(delays, [500, 1000, 2000]);
});

test("permanent, aborted, and ambiguous uploads are not automatically replayed", async () => {
  for (const error of [
    Object.assign(new Error("bad request"), { statusCode: 400 }),
    Object.assign(new Error("aborted"), { name: "AbortError" }),
    Object.assign(new Error("unknown result"), { ambiguous: true }),
  ]) {
    let calls = 0;
    const client = harness({ upload: async () => { calls += 1; throw error; } });
    const photo = { file: input(), clientPhotoId: "stable-id" };
    await assert.rejects(() => client.uploadWithRetry(photo, "parcel", 1, 1, () => {}), error);
    assert.equal(calls, 1);
    if (error.ambiguous) {
      assert.equal(photo.uploadState, "ambiguous");
      await assert.rejects(() => client.uploadWithRetry(photo, "parcel", 1, 1, () => {}),
        (failure) => failure.ambiguous === true);
      assert.equal(calls, 1);
    }
  }
});

test("photo progress stages are client-observed and sequential with no premature backend claims", async () => {
  const calls = [];
  const events = [];
  const client = harness({ upload: async (_id, _file, _photoId, options) => {
    calls.push(options.attempt);
    options.onRequestStart();
    options.onWaiting();
    options.onDiagnostic({ stage: "UPLOAD_COMPLETE", requestId: "A1B2C3D4" });
    return { id: "saved.webp" };
  } });
  const first = { file: input(), clientPhotoId: "first" };
  const second = { file: input(), clientPhotoId: "second" };
  await client.uploadWithRetry(first, "parcel", 1, 2, (_message, event) => events.push(event.stage));
  await client.uploadWithRetry(second, "parcel", 2, 2, (_message, event) => events.push(event.stage));
  assert.deepEqual(calls, [0, 0]);
  assert.deepEqual(events, ["IMAGE_PREPARING", "IMAGE_PREPARED", "REQUEST_STARTING",
    "WAITING_FOR_SERVER", "UPLOAD_SUCCESS", "IMAGE_PREPARING", "IMAGE_PREPARED",
    "REQUEST_STARTING", "WAITING_FOR_SERVER", "UPLOAD_SUCCESS"]);
});

test("failed photo reports one safe failure event without replaying ambiguous upload", async () => {
  const events = [];
  let calls = 0;
  const error = Object.assign(new Error("raw provider detail"), {
    ambiguous: true, diagnosticStage: "DRIVE_UPLOAD", diagnosticCode: "APPS_SCRIPT_TIMEOUT",
    requestId: "A1B2C3D4",
  });
  const client = harness({ upload: async () => { calls += 1; throw error; } });
  const photo = { file: input(), clientPhotoId: "stable" };
  await assert.rejects(() => client.uploadWithRetry(photo, "parcel", 1, 1,
    (_message, event) => events.push(event)), error);
  assert.equal(calls, 1);
  assert.equal(photo.uploadState, "ambiguous");
  assert.equal(events.at(-1).stage, "UPLOAD_FAILED");
  assert.equal(events.at(-1).error.requestId, "A1B2C3D4");
});

test("console success logs only upload stages, indexes and safe request correlation", async () => {
  const client = harness({ upload: async (_id, _file, _photoId, options) => {
    options.onRequestStart();
    options.onWaiting();
    options.onDiagnostic({ stage: "UPLOAD_COMPLETE", requestId: "A1B2C3D4" });
    return { id: "saved.webp" };
  } });
  await client.uploadWithRetry({ file: input(), clientPhotoId: "PRIVATE_PHOTO_ID" },
    "parcel", 1, 1, () => {});
  assert.deepEqual(client.logs.map((entry) => entry.args[0]), [
    "[ParcelUpload] IMAGE_PREPARING", "[ParcelUpload] IMAGE_PREPARED",
    "[ParcelUpload] REQUEST_STARTING", "[ParcelUpload] WAITING_FOR_SERVER",
    "[ParcelUpload] UPLOAD_SUCCESS",
  ]);
  const success = client.logs.at(-1).args[1];
  assert.equal(success.stage, "UPLOAD_COMPLETE");
  assert.equal(success.requestId, "A1B2C3D4");
  assert.equal(success.photoIndex, 1);
  assert.doesNotMatch(JSON.stringify(client.logs), /PRIVATE_PHOTO_ID|Bearer|Authorization|image\/png|camera\.jpg/);
});

test("console HTTP, network and abort diagnostics contain no raw error or upload contents", async () => {
  const cases = [
    { error: Object.assign(new Error("SECRET_PROVIDER_BODY"), { statusCode: 503,
      stage: "DRIVE_UPLOAD", code: "APPS_SCRIPT_TIMEOUT", requestId: "B2C3D4E5", ambiguous: true }),
    label: "[ParcelUpload] BACKEND_HTTP_ERROR", level: "error" },
    { error: Object.assign(new TypeError("SECRET_NETWORK_DETAIL"), {
      stage: "NETWORK_NO_RESPONSE", ambiguous: true }),
    label: "[ParcelUpload] NETWORK_NO_RESPONSE", level: "error" },
    { error: Object.assign(new Error("SECRET_ABORT_DETAIL"), { name: "AbortError",
      stage: "REQUEST_ABORTED", ambiguous: true }),
    label: "[ParcelUpload] REQUEST_ABORTED", level: "warn" },
  ];
  for (const item of cases) {
    const client = harness({ upload: async () => { throw item.error; } });
    await assert.rejects(() => client.uploadWithRetry({ file: input(), clientPhotoId: "PRIVATE_ID" },
      "parcel", 1, 1, () => {}), item.error);
    const logged = client.logs.at(-1);
    assert.equal(logged.level, item.level);
    assert.equal(logged.args[0], item.label);
    assert.doesNotMatch(JSON.stringify(client.logs), /SECRET_|PRIVATE_ID|Bearer|Authorization|image\/png/);
    if (item.error.stage === "NETWORK_NO_RESPONSE") {
      assert.equal(logged.args[1].possibleCause, "CORS_OR_NETWORK");
      assert.equal(logged.args[1].ambiguous, true);
    }
    if (item.error.statusCode) {
      assert.equal(logged.args[1].requestId, "B2C3D4E5");
      assert.equal(logged.args[1].code, "APPS_SCRIPT_TIMEOUT");
    }
  }
});

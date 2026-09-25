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
  const window = {};
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
  return { prepareFile: window.MapParcelPhotoProcessing.prepareFile, drawn, encoded, revoked };
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

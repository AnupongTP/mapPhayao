const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../js/parcel-management.js"), "utf8");

function harness() {
  const elements = [];
  function element(tag) {
    const node = {
      tag, children: [], listeners: {}, textContent: "", hidden: false,
      classList: { toggle() {} },
      append(...items) { this.children.push(...items); },
      appendChild(item) { this.children.push(item); },
      replaceChildren(...items) { this.children = items; },
      setAttribute() {}, addEventListener(name, callback) { this.listeners[name] = callback; },
      focus() {}, remove() {},
    };
    elements.push(node);
    return node;
  }
  const document = { createElement: element, getElementById: () => null,
    body: { appendChild() {} }, activeElement: null };
  const window = { MapFormatters: {}, setTimeout: () => {} };
  vm.runInNewContext(source, { window, document, setTimeout: window.setTimeout });
  function find(className) { return elements.find((item) => item.className === className); }
  function text(node) { return `${node.textContent || ""} ${node.children.map(text).join(" ")}`; }
  return { open: window.MapParcelManagement.openSaveSheet, elements, find, text };
}

const parcel = { name: "Test parcel", cropType: "rice", riceVariety: "RD", plantingDate: "2026-09-26",
  note: "note", photos: [{}] };

test("Save Parcel dialog shows client stages and backend-confirmed success in existing panel", async () => {
  const ui = harness();
  ui.open(parcel, async (progress) => {
    for (const stage of ["PARCEL_SAVED", "IMAGE_PREPARING", "IMAGE_PREPARED",
      "REQUEST_STARTING", "WAITING_FOR_SERVER", "UPLOAD_SUCCESS"]) progress("progress", { stage });
  });
  const button = ui.elements.find((item) => item.tag === "button" && item.textContent === "บันทึกแปลง");
  await button.listeners.click();
  const panel = ui.find("parcel-upload-diagnostic");
  const contents = ui.text(panel);
  assert.equal(panel.hidden, false);
  for (const phrase of ["สถานะระบบ", "บันทึกข้อมูลแปลงสำเร็จ", "เตรียมรูปภาพสำเร็จ",
    "อัปโหลดรูปภาพสำเร็จ", "เซิร์ฟเวอร์ตอบกลับสำเร็จ", "บันทึกข้อมูลรูปภาพสำเร็จ"]) {
    assert.match(contents, new RegExp(phrase));
  }
});

test("Save Parcel dialog shows safe failure boundary, detail and ID without raw exception", async () => {
  const ui = harness();
  ui.open(parcel, async (progress) => {
    progress("saved", { stage: "PARCEL_SAVED" });
    progress("waiting", { stage: "WAITING_FOR_SERVER" });
    const diagnostic = Object.assign(new Error("RAW_SECRET_TOKEN"), {
      diagnosticStage: "DRIVE_UPLOAD", diagnosticCode: "APPS_SCRIPT_TIMEOUT", requestId: "A1B2C3D4",
    });
    progress("failed", { stage: "UPLOAD_FAILED", error: diagnostic });
    throw Object.assign(new Error("บันทึกแปลงแล้ว แต่รูปภาพไม่สำเร็จ"), {
      partialSuccess: true, diagnostic,
    });
  });
  const button = ui.elements.find((item) => item.tag === "button" && item.textContent === "บันทึกแปลง");
  await button.listeners.click();
  const contents = ui.text(ui.find("parcel-upload-diagnostic"));
  assert.match(contents, /Google Drive \/ Apps Script/);
  assert.match(contents, /บริการจัดเก็บรูปภาพไม่ตอบกลับภายในเวลาที่กำหนด/);
  assert.match(contents, /A1B2C3D4/);
  assert.doesNotMatch(contents, /RAW_SECRET_TOKEN/);
});

test("network failure has no backend ID and does not claim server never received request", async () => {
  const ui = harness();
  ui.open(parcel, async (progress) => {
    progress("failed", { stage: "UPLOAD_FAILED", error: {
      diagnosticStage: "NETWORK_NO_RESPONSE", diagnosticCode: "NETWORK_NO_RESPONSE",
    } });
  });
  const button = ui.elements.find((item) => item.tag === "button" && item.textContent === "บันทึกแปลง");
  await button.listeners.click();
  const contents = ui.text(ui.find("parcel-upload-diagnostic"));
  assert.match(contents, /การเชื่อมต่อ Browser → Server/);
  assert.match(contents, /ไม่ได้รับการตอบกลับจากเซิร์ฟเวอร์/);
  assert.match(contents, /รหัสตรวจสอบ: ไม่มี/);
});

test("aborted upload is labelled as cancelled rather than a backend response", async () => {
  const ui = harness();
  ui.open(parcel, async (progress) => {
    progress("failed", { stage: "UPLOAD_FAILED", error: {
      diagnosticStage: "REQUEST_ABORTED", diagnosticCode: "REQUEST_ABORTED",
    } });
  });
  const button = ui.elements.find((item) => item.tag === "button" && item.textContent === "บันทึกแปลง");
  await button.listeners.click();
  const contents = ui.text(ui.find("parcel-upload-diagnostic"));
  assert.match(contents, /คำขออัปโหลดถูกยกเลิก/);
  assert.doesNotMatch(contents, /เซิร์ฟเวอร์ไม่สามารถดำเนินการได้/);
});

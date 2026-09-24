const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "../js/ui-icons.js"),
  "utf8",
);

function createElement(tagName) {
  const attributes = new Map();
  const element = {
    tagName: String(tagName).toUpperCase(),
    className: "",
    children: [],
    textContent: "",
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    replaceChildren(...children) {
      this.children = children;
      this.textContent = children.map((child) => child.textContent || "").join("");
    },
  };
  element.classList = {
    add(...classNames) {
      element.className = [element.className, ...classNames].filter(Boolean).join(" ");
    },
  };
  return element;
}

function loadIcons() {
  const window = {};
  const document = { createElement };
  vm.runInNewContext(source, { window, document });
  return { document, icons: window.MapUiIcons };
}

test("Font Awesome action labels keep readable text and decorative accessible icons", () => {
  const { document, icons } = loadIcons();
  const button = document.createElement("button");

  icons.setActionLabel(button, "วาดพื้นที่แปลง");

  assert.equal(button.children.length, 2);
  assert.equal(button.children[0].className, "fa-solid fa-draw-polygon");
  assert.equal(button.children[0].getAttribute("aria-hidden"), "true");
  assert.equal(button.children[1].textContent, "วาดพื้นที่แปลง");
  assert.equal(button.textContent, "วาดพื้นที่แปลง");
});

test("accordion chevrons use Font Awesome without adding screen-reader noise", () => {
  const { document, icons } = loadIcons();
  const chevron = document.createElement("span");

  icons.setChevron(chevron, true);

  assert.equal(chevron.children.length, 1);
  assert.equal(chevron.children[0].className, "fa-solid fa-chevron-up");
  assert.equal(chevron.children[0].getAttribute("aria-hidden"), "true");
});

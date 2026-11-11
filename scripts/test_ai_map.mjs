import assert from "node:assert/strict";
import { AIPanel } from "../static/js/ai-panel.js";

const labels = [];
const context = {
  fillRect() {},
  strokeRect() {},
  fillText(text) { labels.push(text); },
};
const canvas = {
  width: 0,
  height: 0,
  getContext: () => context,
  toDataURL: () => "data:image/jpeg;base64,AA==",
};
const controls = [
  {
    tagName: "BUTTON",
    innerText: "打开日常演示",
    getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 80, top: 100, right: 240, bottom: 150, width: 160, height: 50 }),
  },
  {
    tagName: "INPUT",
    type: "text",
    value: "private user value",
    placeholder: "姓名",
    labels: [{ innerText: "姓名" }],
    getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 80, top: 180, right: 240, bottom: 230, width: 160, height: 50 }),
  },
];
globalThis.window = { innerWidth: 1200, innerHeight: 800 };
globalThis.document = {
  createElement: () => canvas,
  querySelectorAll: () => controls,
};

const panel = Object.create(AIPanel.prototype);
const image = await panel.capture();

assert.match(image, /^data:image\/jpeg;base64,/);
assert.ok(labels.some((text) => text.includes("打开日常演示")));
assert.ok(labels.some((text) => text.includes("姓名")));
assert.ok(!labels.some((text) => text.includes("private user value")));

console.log("[ok] AI map carries visible control labels without input values");

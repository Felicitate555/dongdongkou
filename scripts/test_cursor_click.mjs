import assert from "node:assert/strict";
import { CursorController } from "../static/js/cursor-controller.js";
import { createControlRuntime } from "../static/js/control-runtime.js";

let staleClicks = 0;
let currentClicks = 0;
const currentButton = { click: () => currentClicks++ };
globalThis.document = {
  elementFromPoint: () => ({ closest: () => currentButton }),
  getElementById: () => globalThis.testToast || null,
  createElement: () => {
    globalThis.testToast = {
      classList: { add() {}, remove() {}, contains: () => false },
    };
    return globalThis.testToast;
  },
  body: { appendChild() {} },
};
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.cancelAnimationFrame = () => {};
globalThis.setTimeout = () => 1;
globalThis.clearTimeout = () => {};

const cursor = new CursorController({
  padEl: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
});
cursor.x = 0.8;
cursor.y = 0.8;
cursor.lockedTarget = { el: { click: () => staleClicks++ } };

assert.equal(cursor.clickVirtual(), true);
assert.equal(currentClicks, 1, "mouth click must follow the current free pointer");
assert.equal(staleClicks, 0, "a previous voice target must not hijack a later direct click");

console.log("[ok] virtual click follows the current free pointer");

let systemClick;
globalThis.window = {
  screenX: 100,
  screenY: 50,
  devicePixelRatio: 2,
  outerHeight: 800,
  innerHeight: 700,
};
globalThis.fetch = async (url, options = {}) => {
  if (url === "/api/health") {
    return { json: async () => ({ system_control: true, screen: [3000, 2000] }) };
  }
  systemClick = JSON.parse(options.body);
  return { ok: true };
};
cursor.mode = "system";
cursor.systemControlAllowed = true;
cursor._controlSession = "test-session";
cursor.x = 0.8;
cursor.y = 0.75;
await cursor.clickSystem("left", 1);
assert.deepEqual(systemClick, { button: "left", clicks: 1, x: 2399, y: 1499 });

console.log("[ok] system click maps the free pointer across the full primary screen");

const stoppedTracks = [];
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: () => stoppedTracks.push(true) }] }),
    },
  },
});
const video = { srcObject: null, play: async () => {} };
const runtime = createControlRuntime({ videoEl: video });
runtime.tracker.init = async () => {
  throw new Error("model load failed");
};
const originalConsoleError = console.error;
console.error = () => {};
await runtime.startCam();
console.error = originalConsoleError;
assert.equal(stoppedTracks.length, 1, "failed model initialization must stop the camera track");
assert.equal(video.srcObject, null, "failed model initialization must release video.srcObject");
assert.equal(runtime.streaming, false);

console.log("[ok] model initialization failure releases camera resources");

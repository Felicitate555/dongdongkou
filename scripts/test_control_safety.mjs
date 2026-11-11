import assert from "node:assert/strict";
import { test } from "node:test";
import { CursorController } from "../static/js/cursor-controller.js";
import { createControlRuntime } from "../static/js/control-runtime.js";

const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
globalThis.document = { getElementById: () => null, addEventListener() {} };
globalThis.window = { addEventListener() {} };
globalThis.cancelAnimationFrame = () => {};
globalThis.requestAnimationFrame = () => 1;
globalThis.sessionStorage = {setItem() {}, removeItem() {}, getItem() {return null;} };

test("stop cancels a camera permission response arriving later", async () => {
  const permission = deferred();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {mediaDevices: {getUserMedia: () => permission.promise}} });
  const video = {srcObject: null, play: async () => {}};
  const runtime = createControlRuntime({videoEl: video});
  runtime.tracker.init = async () => {};
  let stopped = 0;
  const starting = runtime.startCam();
  runtime.stopCam();
  permission.resolve({getTracks: () => [{stop() {stopped++;}}]});
  assert.equal(await starting, false);
  assert.equal(stopped, 1);
  assert.equal(video.srcObject, null);
  assert.equal(runtime.streaming, false);
});

test("stop cancels a model initialization arriving later", async () => {
  const model = deferred();
  let stopped = 0;
  Object.defineProperty(globalThis, "navigator", {configurable: true, value: {mediaDevices: {getUserMedia: async () => ({getTracks: () => [{stop() {stopped++;}}]})}}});
  const video = {srcObject: null, play: async () => {}};
  const runtime = createControlRuntime({videoEl: video});
  runtime.tracker.init = () => model.promise;
  const starting = runtime.startCam();
  await new Promise(resolve => setImmediate(resolve));
  runtime.stopCam();
  model.resolve();
  assert.equal(await starting, false);
  assert.equal(runtime.streaming, false);
  assert.equal(stopped, 1);
});

test("a late health response after stop never dispatches mouse down/click", async () => {
  for (const action of ["clickSystem", "_systemDown"]) {
    const health = deferred();
    const sent = [];
    globalThis.fetch = async (url) => {
      if (url === "/api/health") return health.promise;
      sent.push(url);
      return {ok: true, json: async () => ({})};
    };
    const cursor = new CursorController();
    cursor.mode = "system";
    cursor.systemControlAllowed = true;
    cursor._controlSession = "test-session";
    const pending = cursor[action]();
    await cursor.stopSystem();
    health.resolve({ok: true, json: async () => ({system_control: true, screen: [2560,1600]})});
    await pending;
    assert.equal(sent.some(url => /mouse\/(down|click)$/.test(url)), false);
    assert.equal(cursor.mode, "virtual");
  }
});

test("slow move requests cannot accumulate", async () => {
  const move = deferred();
  let moves = 0;
  globalThis.fetch = async (url) => {
    if (url === "/api/mouse/move") {moves++; return move.promise;}
    return {ok: true, json: async () => ({})};
  };
  const cursor = new CursorController();
  cursor.mode = "system";
  cursor.systemControlAllowed = true;
  cursor._controlSession = "test-session";
  cursor._screenCache = {system_control: true, screen: [2560,1600]};
  cursor._systemTimer = -1000;
  const first = cursor._pushSystem();
  await new Promise(resolve => setImmediate(resolve));
  cursor._systemTimer = -1000;
  const second = cursor._pushSystem();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(moves, 1);
  move.resolve({ok: true});
  await Promise.all([first, second]);
});

test("another emergency stop revokes a new session while an old stop is pending", async () => {
  const oldStop = deferred();
  globalThis.fetch = async (url, options) => {
    if (url === "/api/control/stop" && options.headers["X-DDK-Control-Session"] === "old") return oldStop.promise;
    return {ok: true};
  };
  const runtime = createControlRuntime({});
  runtime.cursor.mode = "system";
  runtime.cursor._controlSession = "old";
  const first = runtime.emergencyStop();
  runtime.cursor.mode = "system";
  runtime.cursor._controlSession = "new";
  await runtime.emergencyStop();
  assert.equal(runtime.cursor.mode, "virtual");
  assert.equal(runtime.cursor._controlSession, null);
  oldStop.resolve({ok: true});
  await first;
});

test("failed click health check notifies runtime to stop all input", async () => {
  globalThis.fetch = async () => {throw new Error("offline");};
  let fallbacks = 0;
  const cursor = new CursorController({onFallback: () => {fallbacks++;}});
  cursor.mode = "system";
  cursor._controlSession = "test-session";
  assert.equal(await cursor.clickSystem(), false);
  assert.equal(cursor.mode, "virtual");
  assert.equal(fallbacks, 1);
});

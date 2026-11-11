/** Node 检查：可选目标辅助 / 张嘴纯函数 + 语音命令契约 */
import assert from "node:assert";
import { nearestTarget, isMouthOpen, clamp01, mapNormalizedToScreen } from "../static/js/geometry.js";
import { VoiceController } from "../static/js/voice-controller.js";

const targets = [
  { id: 0, x: 100, y: 100, text: "A" },
  { id: 1, x: 300, y: 100, text: "B" },
  { id: 2, x: 100, y: 400, text: "C" },
];

assert.strictEqual(nearestTarget(110, 105, targets, 80)?.id, 0, "near A");
assert.strictEqual(nearestTarget(280, 100, targets, 50)?.id, 1, "near B");
assert.strictEqual(nearestTarget(500, 500, targets, 40), null, "out of radius");
assert.strictEqual(nearestTarget(0, 0, [], 80), null, "empty list");

assert.strictEqual(isMouthOpen(0.6, 0.5), true);
assert.strictEqual(isMouthOpen(0.4, 0.5), false);
assert.strictEqual(isMouthOpen(0.5, 0.5), true);

assert.strictEqual(clamp01(0), 0.01);
assert.strictEqual(clamp01(2), 0.99);
assert.strictEqual(clamp01(0.5), 0.5);

const [sx, sy] = mapNormalizedToScreen(0.5, 0.25, 1920, 1080);
assert.strictEqual(sx, 960);
assert.strictEqual(sy, 270);

const vc = new VoiceController({ onCommand: () => {} });
for (const phrase of ["下一目标", "上一目标", "第2个", "点击", "帮我看看", "打开购物"]) {
  const cmd = vc.match(phrase);
  assert.ok(cmd, `voice should match: ${phrase}`);
}
assert.strictEqual(vc.match("下一目标")?.action, "next_target");
assert.strictEqual(vc.match("第2个")?.value, 2);

console.log("[ok] js geometry + voice contract");

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateFlameEnvelope,
  fillFlameVertices,
  type FlameLayerParams,
} from './fireCanvas.ts';

const SAMPLE_LAYER: FlameLayerParams = {
  baseRatio: 0.35,
  ampRatio: 0.55,
  freq: 0.022,
  speed: 2.1,
  phase: 0.4,
  sharpness: 1.4,
};

test('evaluateFlameEnvelope stays normalized in [0, 1] across arbitrary space and time', () => {
  for (let x = 0; x <= 2400; x += 37) {
    for (let t = 0; t <= 10; t += 0.7) {
      const val = evaluateFlameEnvelope(x, t, SAMPLE_LAYER);
      assert.ok(Number.isFinite(val), `Expected finite value at x=${x}, t=${t}`);
      assert.ok(val >= 0 && val <= 1, `Expected normalized envelope [0,1], got ${val}`);
    }
  }
});

test('fillFlameVertices populates monotonic X vertices within canvas bounds', () => {
  const width = 1280;
  const height = 140;
  const maxFlameHeight = 110;
  const stepPx = 28;
  const cap = Math.ceil(width / stepPx) + 2;
  const xs = new Float32Array(cap);
  const ys = new Float32Array(cap);

  const count = fillFlameVertices(xs, ys, width, height, maxFlameHeight, stepPx, 1.25, SAMPLE_LAYER);
  assert.equal(count, cap);
  assert.equal(xs[0], 0);
  assert.equal(xs[count - 1], width);

  for (let i = 0; i < count; i++) {
    assert.ok(ys[i] >= 2 && ys[i] < height, `Vertex ${i} out of vertical bounds: ${ys[i]}`);
    if (i > 0) {
      assert.ok(xs[i] >= xs[i - 1], 'X coordinates must remain non-decreasing');
    }
  }
});

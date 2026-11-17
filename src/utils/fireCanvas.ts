export interface FlameLayerParams {
  /** Base height ratio (0..1 of canvas height) above the bottom edge */
  baseRatio: number;
  /** Peak modulation ratio (0..1 of canvas height) */
  ampRatio: number;
  /** Spatial frequency multiplier */
  freq: number;
  /** Temporal animation speed multiplier */
  speed: number;
  /** Phase offset in radians */
  phase: number;
  /** Crest sharpness exponent (>= 1 makes tongues sharper at peaks, rounded in valleys) */
  sharpness: number;
}

/**
 * Computes an organic, asymmetric flame envelope value in [0, 1].
 * Pure function suitable for unit testing and zero-allocation buffer filling.
 */
export function evaluateFlameEnvelope(
  xPx: number,
  timeSec: number,
  params: FlameLayerParams
): number {
  const f = params.freq;
  const s = params.speed;
  const p = params.phase;

  // Combine 3 incommensurate harmonics + slow wind lean so tongues never repeat visibly
  const w1 = Math.sin(xPx * f + timeSec * s + p);
  const w2 = Math.sin(xPx * (f * 1.93) - timeSec * (s * 1.47) + p * 1.7 + w1 * 0.45);
  const w3 = Math.cos(xPx * (f * 0.51) + timeSec * (s * 0.63) - p * 0.6);

  const combined = w1 * 0.52 + w2 * 0.31 + w3 * 0.17; // bounded in [-1, 1]
  const normalized = Math.max(0, Math.min(1, 0.5 + 0.5 * combined));
  return Math.pow(normalized, params.sharpness);
}

/**
 * Fills pre-allocated typed arrays (xs, ys) with smooth flame silhouette coordinates.
 * Returns the number of populated vertices.
 */
export function fillFlameVertices(
  xs: Float32Array,
  ys: Float32Array,
  width: number,
  height: number,
  maxFlameHeight: number,
  stepPx: number,
  timeSec: number,
  params: FlameLayerParams
): number {
  const count = Math.min(xs.length, Math.ceil(width / stepPx) + 2);
  const baseH = maxFlameHeight * params.baseRatio;
  const ampH = maxFlameHeight * params.ampRatio;

  for (let i = 0; i < count; i++) {
    const x = Math.min(width, i * stepPx);
    const env = evaluateFlameEnvelope(x, timeSec, params);
    xs[i] = x;
    ys[i] = Math.max(2, height - (baseH + env * ampH));
  }
  return count;
}

/**
 * Traces a silky quadratic-bezier closed path from precomputed vertices along the bottom edge.
 * Avoids sharp polygon corners with minimal vertex count for 60 FPS canvas throughput.
 */
export function traceSmoothFlamePath(
  ctx: CanvasRenderingContext2D,
  xs: Float32Array,
  ys: Float32Array,
  count: number,
  width: number,
  height: number
): void {
  if (count < 2) return;
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(xs[0], ys[0]);

  for (let i = 0; i < count - 1; i++) {
    const midX = (xs[i] + xs[i + 1]) * 0.5;
    const midY = (ys[i] + ys[i + 1]) * 0.5;
    ctx.quadraticCurveTo(xs[i], ys[i], midX, midY);
  }

  ctx.lineTo(xs[count - 1], ys[count - 1]);
  ctx.lineTo(width, height);
  ctx.closePath();
}

/**
 * Creates a small offscreen radial glow sprite for fast hardware-accelerated bitmap blitting
 * instead of slow per-frame shadowBlur or per-particle radial gradient allocations.
 */
export function createGlowSprite(
  size: number,
  innerStop: string,
  midStop: string,
  outerStop: string
): HTMLCanvasElement {
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const sCtx = sprite.getContext('2d');
  if (!sCtx) return sprite;

  const half = size * 0.5;
  const grad = sCtx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, innerStop);
  grad.addColorStop(0.36, midStop);
  grad.addColorStop(1, outerStop);

  sCtx.fillStyle = grad;
  sCtx.fillRect(0, 0, size, size);
  return sprite;
}

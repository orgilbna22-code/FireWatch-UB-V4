import React, { useEffect, useRef, useState } from 'react';
import type { Language } from '../../types';
import {
  createGlowSprite,
  fillFlameVertices,
  traceSmoothFlamePath,
  type FlameLayerParams,
} from '../../utils/fireCanvas';

export type FireBackgroundMode = 'vivid' | 'soft' | 'off';

interface GlobalFireBackgroundProps {
  initialMode?: FireBackgroundMode;
  language?: Language;
  hideRibbon?: boolean;
}

const LAYER_BACK: FlameLayerParams = {
  baseRatio: 0.28,
  ampRatio: 0.62,
  freq: 0.019,
  speed: 1.7,
  phase: 0.2,
  sharpness: 1.55,
};

const LAYER_MID: FlameLayerParams = {
  baseRatio: 0.2,
  ampRatio: 0.52,
  freq: 0.031,
  speed: 2.55,
  phase: 2.1,
  sharpness: 1.85,
};

const LAYER_CORE: FlameLayerParams = {
  baseRatio: 0.12,
  ampRatio: 0.34,
  freq: 0.044,
  speed: 3.35,
  phase: 4.3,
  sharpness: 2.1,
};

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  decay: number;
  swirlPhase: number;
  swirlFreq: number;
  spriteIdx: number;
  isBokeh: boolean;
}

export const GlobalFireBackground: React.FC<GlobalFireBackgroundProps> = ({
  initialMode = 'soft',
  language = 'mn',
  hideRibbon = false,
}) => {
  const isMn = language === 'mn';
  const [mode, setMode] = useState<FireBackgroundMode>(() => {
    try {
      const saved = localStorage.getItem('firewatch_bg_mode');
      if (saved === 'vivid' || saved === 'soft' || saved === 'off') return saved;
    } catch {
      // ignore
    }
    return initialMode;
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isCompactViewport, setIsCompactViewport] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setIsCompactViewport(e.matches);
    const onRmChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    rm.addEventListener('change', onRmChange);
    return () => {
      mq.removeEventListener('change', onChange);
      rm.removeEventListener('change', onRmChange);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('firewatch_bg_mode', mode);
    } catch {
      // ignore
    }
  }, [mode]);

  // Volumetric multi-layer Bezier flame + pre-rendered sprite embers (zero shadowBlur, zero per-frame allocations)
  useEffect(() => {
    if (mode === 'off' || hideRibbon) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const isVivid = mode === 'vivid';
    const cssHeight = isCompactViewport ? (isVivid ? 82 : 60) : isVivid ? 148 : 100;
    const stepPx = isCompactViewport ? 22 : 28;

    // Pre-rendered optical glow sprites (1x setup cost, hardware-accelerated blitting)
    const sprites = [
      createGlowSprite(32, 'rgba(255, 252, 220, 1)', 'rgba(255, 214, 102, 0.78)', 'rgba(255, 140, 40, 0)'),
      createGlowSprite(32, 'rgba(255, 220, 130, 0.96)', 'rgba(255, 130, 52, 0.68)', 'rgba(233, 59, 47, 0)'),
      createGlowSprite(32, 'rgba(255, 140, 70, 0.92)', 'rgba(233, 59, 47, 0.56)', 'rgba(180, 20, 20, 0)'),
      createGlowSprite(40, 'rgba(255, 185, 95, 0.45)', 'rgba(255, 99, 60, 0.18)', 'rgba(255, 99, 60, 0)'),
    ];

    let animId = 0;
    let width = 1280;
    let height = cssHeight;
    let flameMaxH = height * (isVivid ? 0.88 : 0.78);
    let xs = new Float32Array(128);
    let ys = new Float32Array(128);
    let gradBack!: CanvasGradient;
    let gradMid!: CanvasGradient;
    let gradCore!: CanvasGradient;

    const rebuildSize = () => {
      if (!canvas) return;
      width = Math.max(320, window.innerWidth);
      height = cssHeight;
      // Soft atmospheric backdrop uses 1x pixel grid for >2x faster fill rate on HiDPI & CPU GPUs
      canvas.width = width;
      canvas.height = height;

      flameMaxH = height * (isVivid ? 0.9 : 0.8);
      const needed = Math.ceil(width / stepPx) + 4;
      if (xs.length < needed) {
        xs = new Float32Array(needed);
        ys = new Float32Array(needed);
      }

      // Feathered top stops fade smoothly into transparent air instead of hard geometric edges
      gradBack = ctx.createLinearGradient(0, height - flameMaxH, 0, height);
      gradBack.addColorStop(0, isVivid ? 'rgba(255, 88, 42, 0.12)' : 'rgba(255, 94, 50, 0.08)');
      gradBack.addColorStop(0.32, isVivid ? 'rgba(255, 76, 38, 0.64)' : 'rgba(240, 72, 42, 0.44)');
      gradBack.addColorStop(0.7, isVivid ? 'rgba(220, 38, 28, 0.88)' : 'rgba(198, 32, 26, 0.72)');
      gradBack.addColorStop(1, isVivid ? 'rgba(145, 16, 18, 0.96)' : 'rgba(130, 18, 22, 0.86)');

      gradMid = ctx.createLinearGradient(0, height - flameMaxH * 0.8, 0, height);
      gradMid.addColorStop(0, isVivid ? 'rgba(255, 196, 86, 0.22)' : 'rgba(255, 178, 74, 0.14)');
      gradMid.addColorStop(0.36, isVivid ? 'rgba(255, 128, 52, 0.82)' : 'rgba(255, 118, 52, 0.62)');
      gradMid.addColorStop(0.76, isVivid ? 'rgba(255, 82, 42, 0.9)' : 'rgba(235, 72, 40, 0.76)');
      gradMid.addColorStop(1, 'rgba(225, 42, 30, 0.94)');

      gradCore = ctx.createLinearGradient(0, height - flameMaxH * 0.52, 0, height);
      gradCore.addColorStop(0, isVivid ? 'rgba(255, 248, 200, 0.42)' : 'rgba(255, 236, 158, 0.26)');
      gradCore.addColorStop(0.45, isVivid ? 'rgba(255, 224, 122, 0.92)' : 'rgba(255, 204, 102, 0.74)');
      gradCore.addColorStop(1, 'rgba(255, 128, 48, 0.94)');
    };

    rebuildSize();
    window.addEventListener('resize', rebuildSize);

    const emberCount = isCompactViewport ? (isVivid ? 20 : 12) : isVivid ? 38 : 22;
    const resetEmber = (e: Ember, randomY: boolean) => {
      const isBokeh = Math.random() < 0.24;
      e.isBokeh = isBokeh;
      e.x = Math.random() * width;
      e.y = randomY ? Math.random() * height : height - Math.random() * 14;
      e.vx = (Math.random() - 0.5) * 18;
      e.vy = -(isBokeh ? 18 + Math.random() * 24 : 38 + Math.random() * 58) * (isVivid ? 1.15 : 0.9);
      e.size = isBokeh ? 12 + Math.random() * 14 : 4.5 + Math.random() * 7;
      e.alpha = isBokeh ? 0.35 + Math.random() * 0.35 : 0.65 + Math.random() * 0.35;
      e.decay = isBokeh ? 0.25 + Math.random() * 0.2 : 0.38 + Math.random() * 0.45;
      e.swirlPhase = Math.random() * Math.PI * 2;
      e.swirlFreq = 2 + Math.random() * 2.5;
      e.spriteIdx = isBokeh ? 3 : Math.floor(Math.random() * 3);
    };

    const embers: Ember[] = Array.from({ length: emberCount }, () => {
      const e = {} as Ember;
      resetEmber(e, true);
      return e;
    });

    let timeSec = 0;
    let lastNow = performance.now();

    const drawFrame = (dt: number, animateEmbers: boolean) => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = 1;

      // 1. Back crimson-vermilion volumetric mantle
      const c1 = fillFlameVertices(xs, ys, width, height, flameMaxH, stepPx, timeSec, LAYER_BACK);
      traceSmoothFlamePath(ctx, xs, ys, c1, width, height);
      ctx.fillStyle = gradBack;
      ctx.fill();

      // 2. Mid dynamic orange-amber flame tongues
      const c2 = fillFlameVertices(xs, ys, width, height, flameMaxH, stepPx, timeSec, LAYER_MID);
      traceSmoothFlamePath(ctx, xs, ys, c2, width, height);
      ctx.fillStyle = gradMid;
      ctx.fill();

      // 3. Incandescent gold-white inner hearth core
      ctx.globalAlpha = isVivid ? 0.88 : 0.72;
      const c3 = fillFlameVertices(xs, ys, width, height, flameMaxH, stepPx, timeSec, LAYER_CORE);
      traceSmoothFlamePath(ctx, xs, ys, c3, width, height);
      ctx.fillStyle = gradCore;
      ctx.fill();

      // 4. Rising luminous sparks + out-of-focus heat motes
      for (let i = 0; i < embers.length; i++) {
        const e = embers[i];
        if (animateEmbers) {
          e.swirlPhase += dt * e.swirlFreq;
          e.x += (e.vx + Math.sin(e.swirlPhase) * 16) * dt;
          e.y += e.vy * dt;
          e.alpha -= e.decay * dt;

          if (e.y < -e.size || e.alpha <= 0.02) {
            resetEmber(e, false);
          }
        }

        const clampedAlpha = Math.max(0, Math.min(1, e.alpha));
        if (clampedAlpha <= 0.02) continue;

        ctx.globalAlpha = clampedAlpha;
        const sprite = sprites[e.spriteIdx];
        const half = e.size;
        const stretchY = e.isBokeh ? half * 2 : half * 2.4;
        ctx.drawImage(sprite, e.x - half, e.y - stretchY * 0.5, half * 2, stretchY);
      }

      ctx.globalAlpha = 1;
    };

    if (prefersReducedMotion) {
      drawFrame(0, false);
      return () => {
        window.removeEventListener('resize', rebuildSize);
      };
    }

    const render = (now: number) => {
      animId = requestAnimationFrame(render);
      if (document.hidden) {
        lastNow = now;
        return;
      }
      const elapsedMs = now - lastNow;
      if (elapsedMs < 15) return; // cap nicely around 60fps on 120Hz displays without jitter
      const dt = Math.min(elapsedMs / 1000, 0.05);
      lastNow = now;
      timeSec += dt * (isVivid ? 1.15 : 0.9);
      drawFrame(dt, true);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', rebuildSize);
    };
  }, [mode, isCompactViewport, hideRibbon, prefersReducedMotion]);

  const isOff = mode === 'off';

  return (
    <>
      {/* Smooth hardware-accelerated bottom flame backdrop (zero blur filters, 60fps locked) */}
      {!isOff && !hideRibbon && (
        <div
          className={`fire-ambient-bg fixed bottom-[60px] sm:bottom-0 left-0 right-0 print:hidden pointer-events-none z-[32] overflow-hidden select-none ${
            mode === 'vivid' ? 'h-[82px] sm:h-[148px]' : 'h-[60px] sm:h-[100px]'
          }`}
          style={{ contain: 'strict' }}
          aria-hidden="true"
        >
          {/* Pure multi-stop atmospheric thermal haze (no heavy CSS blur filter) */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                mode === 'vivid'
                  ? 'linear-gradient(to top, rgba(233,59,47,0.34) 0%, rgba(255,112,56,0.16) 48%, rgba(255,99,60,0) 100%)'
                  : 'linear-gradient(to top, rgba(233,59,47,0.24) 0%, rgba(255,112,56,0.10) 45%, rgba(255,99,60,0) 100%)',
            }}
          />

          <canvas
            ref={canvasRef}
            data-decorative="true"
            className="absolute bottom-0 left-0 w-full h-full pointer-events-none"
          />
        </div>
      )}

      {/* Clean, Non-intrusive Control Pill (Bottom Right - Desktop only, hidden on full-bleed map) */}
      {!hideRibbon && (
        <div className="hidden lg:block fixed bottom-3 right-3 z-[45] print:hidden">
          <div className="bg-white/95 dark:bg-[#0D1324]/92 backdrop-blur-xl px-3 py-1.5 rounded-full border border-black/[0.08] dark:border-white/15 shadow-lg flex items-center gap-2 text-xs font-sans transition-colors hover:bg-white dark:hover:bg-[#11192E]">
            <span className="flex items-center gap-1 font-bold text-[#0B124D] dark:text-slate-100 text-[11px]">
              <span className={`w-2 h-2 rounded-full ${isOff ? 'bg-slate-300 dark:bg-slate-600' : 'bg-[#FF633C] animate-pulse'}`} />
              {isMn ? '🔥 Арын гал:' : '🔥 Backdrop fire:'}
            </span>

            <div className="flex items-center bg-[#F2F4F7] dark:bg-slate-800/80 p-0.5 rounded-full text-[10px] font-semibold">
              <button
                onClick={() => setMode('soft')}
                className={`px-2 py-0.5 rounded-full transition-colors ${
                  mode === 'soft'
                    ? 'bg-[#0B124D] dark:bg-[#FF633C] text-white font-bold shadow-xs'
                    : 'text-[#72778A] dark:text-slate-400 hover:text-black dark:hover:text-white'
                }`}
                title={isMn ? 'Зөөлөн, намуун галын дөл' : 'Soft, gentle flames'}
              >
                {isMn ? 'Зөөлөн' : 'Soft'}
              </button>
              <button
                onClick={() => setMode('vivid')}
                className={`px-2 py-0.5 rounded-full transition-colors ${
                  mode === 'vivid'
                    ? 'bg-[#FF633C] text-white font-bold shadow-xs'
                    : 'text-[#72778A] dark:text-slate-400 hover:text-black dark:hover:text-white'
                }`}
                title={isMn ? 'Тод галын дөл' : 'Vivid flames'}
              >
                {isMn ? 'Тод' : 'Vivid'}
              </button>
              <button
                onClick={() => setMode('off')}
                className={`px-2 py-0.5 rounded-full transition-colors ${
                  mode === 'off'
                    ? 'bg-slate-700 text-white font-bold shadow-xs'
                    : 'text-[#72778A] dark:text-slate-400 hover:text-black dark:hover:text-white'
                }`}
                title={isMn ? 'Галыг унтраах' : 'Turn the backdrop off'}
              >
                {isMn ? 'Хаах' : 'Off'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

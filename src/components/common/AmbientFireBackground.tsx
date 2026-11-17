import React, { useEffect, useRef } from 'react';
import { createGlowSprite } from '../../utils/fireCanvas';

interface AmbientFireBackgroundProps {
  className?: string;
  intensity?: number;
}

interface FloatingSpark {
  x: number;
  y: number;
  radius: number;
  speedY: number;
  swirlPhase: number;
  swirlFreq: number;
  swirlAmp: number;
  alpha: number;
  maxAlpha: number;
  flickerSpeed: number;
  spriteIdx: number;
}

interface HeatPlume {
  xFrac: number;
  y: number;
  speedY: number;
  radius: number;
  alpha: number;
  swayPhase: number;
}

export const AmbientFireBackground: React.FC<AmbientFireBackgroundProps> = ({
  className = '',
  intensity = 1.0,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Pre-render offscreen sprites once (eliminates heavy CSS filter: blur passes)
    const sparkSprites = [
      createGlowSprite(32, 'rgba(255, 250, 210, 1)', 'rgba(255, 214, 102, 0.72)', 'rgba(255, 160, 60, 0)'),
      createGlowSprite(32, 'rgba(255, 200, 110, 0.95)', 'rgba(255, 118, 52, 0.62)', 'rgba(233, 59, 47, 0)'),
      createGlowSprite(32, 'rgba(255, 128, 65, 0.9)', 'rgba(233, 59, 47, 0.5)', 'rgba(180, 25, 25, 0)'),
      createGlowSprite(48, 'rgba(255, 178, 92, 0.42)', 'rgba(255, 99, 60, 0.16)', 'rgba(255, 99, 60, 0)'),
    ];
    const plumeSprite = createGlowSprite(
      128,
      'rgba(255, 108, 56, 0.34)',
      'rgba(233, 59, 47, 0.14)',
      'rgba(11, 18, 77, 0)'
    );

    let width = 400;
    let height = 600;

    const handleResize = () => {
      if (!canvas) return;
      const nextW = canvas.offsetWidth || canvas.parentElement?.clientWidth || 400;
      const nextH = canvas.offsetHeight || canvas.parentElement?.clientHeight || 600;
      if (nextW > 0 && nextH > 0) {
        width = nextW;
        height = nextH;
        canvas.width = width;
        canvas.height = height;
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      ro = new ResizeObserver(handleResize);
      ro.observe(canvas.parentElement);
    }

    const sparks: FloatingSpark[] = Array.from({ length: 24 }, () => {
      const isBokeh = Math.random() < 0.25;
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        radius: isBokeh ? 10 + Math.random() * 14 : 3.5 + Math.random() * 6,
        speedY: (isBokeh ? 14 + Math.random() * 16 : 26 + Math.random() * 44) * intensity,
        swirlPhase: Math.random() * Math.PI * 2,
        swirlFreq: 1.2 + Math.random() * 1.8,
        swirlAmp: 8 + Math.random() * 18,
        alpha: 0.25 + Math.random() * 0.6,
        maxAlpha: isBokeh ? 0.45 : 0.94,
        flickerSpeed: 2.5 + Math.random() * 4,
        spriteIdx: isBokeh ? 3 : Math.floor(Math.random() * 3),
      };
    });

    const plumes: HeatPlume[] = Array.from({ length: 4 }, (_, idx) => ({
      xFrac: 0.14 + idx * 0.24,
      y: height * (0.45 + Math.random() * 0.55),
      speedY: (13 + Math.random() * 14) * intensity,
      radius: 115 + Math.random() * 70,
      alpha: 0.26 + Math.random() * 0.18,
      swayPhase: Math.random() * Math.PI * 2,
    }));

    let isVisible = true;
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        (entries) => {
          isVisible = entries[0]?.isIntersecting ?? true;
        },
        { threshold: 0.02 }
      );
      io.observe(container);
    }

    let animId = 0;
    let timeSec = 0;
    let lastNow = performance.now();

    const drawFrame = (dt: number, animate: boolean) => {
      ctx.clearRect(0, 0, width, height);

      // 1. Soft rising thermal light plumes (cheap single drawImage blits)
      for (let i = 0; i < plumes.length; i++) {
        const p = plumes[i];
        if (animate) {
          p.y -= p.speedY * dt;
          p.swayPhase += dt * 0.85;
          if (p.y < -p.radius) {
            p.y = height + p.radius * 0.6;
            p.xFrac = 0.12 + Math.random() * 0.76;
          }
        }
        const heightFade = Math.max(0, Math.min(1, p.y / (height * 0.95)));
        const px = p.xFrac * width + Math.sin(p.swayPhase) * 26;
        ctx.globalAlpha = p.alpha * heightFade;
        ctx.drawImage(plumeSprite, px - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2);
      }

      // 2. Silky helical rising embers + bokeh heat motes
      for (let i = 0; i < sparks.length; i++) {
        const s = sparks[i];
        if (animate) {
          s.y -= s.speedY * dt;
          s.swirlPhase += s.swirlFreq * dt;
          if (s.y < -s.radius * 2) {
            s.y = height + s.radius;
            s.x = Math.random() * width;
          }
        }

        const currentX = s.x + Math.sin(s.swirlPhase) * s.swirlAmp;
        const heightEnvelope = Math.sin(Math.max(0, Math.min(1, s.y / height)) * Math.PI * 0.9);
        const flicker = 0.75 + 0.25 * Math.sin(timeSec * s.flickerSpeed + i);
        ctx.globalAlpha = Math.max(0, Math.min(s.maxAlpha, s.alpha * heightEnvelope * flicker));

        const sprite = sparkSprites[s.spriteIdx];
        const size = s.radius * 2;
        ctx.drawImage(sprite, currentX - s.radius, s.y - s.radius, size, size);
      }

      ctx.globalAlpha = 1;
    };

    if (prefersReducedMotion) {
      drawFrame(0, false);
      return () => {
        window.removeEventListener('resize', handleResize);
        if (ro) ro.disconnect();
        if (io) io.disconnect();
      };
    }

    const render = (now: number) => {
      animId = requestAnimationFrame(render);
      if (!isVisible || document.hidden) {
        lastNow = now;
        return;
      }
      const elapsedMs = now - lastNow;
      if (elapsedMs < 15) return;
      const dt = Math.min(elapsedMs / 1000, 0.05);
      lastNow = now;
      timeSec += dt;
      drawFrame(dt, true);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      if (ro) ro.disconnect();
      if (io) io.disconnect();
    };
  }, [intensity]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 overflow-hidden pointer-events-none select-none ${className}`}
      style={{ contain: 'strict' }}
      aria-hidden="true"
    >
      {/* Pure GPU radial hearth glow (no expensive CSS filter: blur passes) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 95% 65% at 50% 102%, rgba(255, 99, 60, 0.44) 0%, rgba(233, 59, 47, 0.24) 38%, rgba(11, 18, 77, 0) 78%)',
        }}
      />

      {/* Warm lower rim sheen */}
      <div
        className="absolute bottom-0 left-0 right-0 h-44 pointer-events-none"
        style={{
          background:
            'linear-gradient(to top, rgba(255, 118, 52, 0.28) 0%, rgba(255, 99, 60, 0.08) 52%, rgba(11, 18, 77, 0) 100%)',
        }}
      />

      {/* Volumetric plumes & glowing embers canvas */}
      <canvas
        ref={canvasRef}
        data-decorative="true"
        className="absolute inset-0 w-full h-full pointer-events-none"
      />
    </div>
  );
};

"use client";

import { useEffect, useRef } from "react";

// Ambient atmosphere: a few faint pink embers drifting slowly upward with a
// gentle horizontal sway, twinkling as they rise. Purely decorative — sits
// behind everything and ignores pointer events.
//
// Removable: delete this file and its single <Embers /> usage in page.tsx.

interface Ember {
  x: number;
  y: number;
  radius: number;
  speed: number; // upward px/sec
  swayAmp: number; // horizontal sway amplitude
  swayFreq: number; // sway cycles/sec
  phase: number; // sway phase offset
  baseAlpha: number;
  twinkleFreq: number;
}

const EMBER_COUNT = 34;
const PINK_SOFT = "255, 143, 177";

export default function Embers() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let embers: Ember[] = [];
    let cssWidth = 0;
    let cssHeight = 0;

    const makeEmber = (atRandomHeight: boolean): Ember => ({
      x: Math.random() * cssWidth,
      y: atRandomHeight ? Math.random() * cssHeight : cssHeight + 10,
      radius: 0.8 + Math.random() * 2.2,
      speed: 8 + Math.random() * 22,
      swayAmp: 6 + Math.random() * 18,
      swayFreq: 0.05 + Math.random() * 0.15,
      phase: Math.random() * Math.PI * 2,
      baseAlpha: 0.15 + Math.random() * 0.35,
      twinkleFreq: 0.2 + Math.random() * 0.6,
    });

    const initEmbers = () => {
      embers = Array.from({ length: EMBER_COUNT }, () => makeEmber(true));
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      cssWidth = window.innerWidth;
      cssHeight = window.innerHeight;
      canvas.width = Math.floor(cssWidth * dpr);
      canvas.height = Math.floor(cssHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initEmbers();
    };

    let start: number | null = null;
    const draw = (time: number) => {
      if (!start) start = time;
      const t = (time - start) / 1000; // seconds

      ctx.clearRect(0, 0, cssWidth, cssHeight);

      for (const e of embers) {
        // Rise, recycling to the bottom once fully off the top.
        e.y -= (e.speed / 60) * 1;
        if (e.y < -10) {
          Object.assign(e, makeEmber(false));
          continue;
        }

        const sway = Math.sin(t * e.swayFreq * Math.PI * 2 + e.phase) * e.swayAmp;
        const twinkle = 0.6 + 0.4 * Math.sin(t * e.twinkleFreq * Math.PI * 2 + e.phase);
        const alpha = e.baseAlpha * twinkle;

        ctx.beginPath();
        ctx.arc(e.x + sway, e.y, e.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${PINK_SOFT}, ${alpha})`;
        ctx.shadowColor = `rgba(${PINK_SOFT}, ${alpha})`;
        ctx.shadowBlur = 8;
        ctx.fill();
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    window.addEventListener("resize", resize);
    resize();
    animationFrameId = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none -z-10"
    />
  );
}

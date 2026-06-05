"use client";

import { useEffect, useRef } from "react";

interface Point {
  // Offset from the heart's center; the actual draw position is derived
  // each frame so the whole shape can pulse (heartbeat) around its middle.
  offsetX: number;
  offsetY: number;
  alpha: number;
  targetAlpha: number;
  delay: number;
  text: string;
  color: string;
  outline: boolean;
  fadingOut: boolean;
  // glitch decode state
  scrambleStart: number;
  scrambleDuration: number;
  cachedDisplay: string;
  lastShuffleAt: number;
}

// Outer outline always uses the same phrase so the silhouette stays clean.
const OUTLINE_WORD = "i love you";

// The main message stays dominant; everything in NICKNAMES splits the
// remaining probability evenly, so names can be added/removed freely
// without ever re-tuning weights by hand.
const MAIN_WORD = "i love you";
const MAIN_WEIGHT = 0.35;
const NICKNAMES = [
  "baby",
  "beautiful",
  "gorgeous",
  "strawberry",
  "princess",
  "my love",
  "sweetheart",
  "angel",
  "cutie",
  "sunshine",
  "honey",
  "pretty girl",
];

const pickInnerWord = () => {
  if (Math.random() < MAIN_WEIGHT) return MAIN_WORD;
  return NICKNAMES[Math.floor(Math.random() * NICKNAMES.length)];
};

// Only the main "i love you" message is pink; the rest render white.
const PINK = "255, 77, 109";
const WHITE = "255, 255, 255";
const colorFor = (word: string) => (word === MAIN_WORD ? PINK : WHITE);

// Glitch-decode helpers — scramble each letter through random hex chars
// and resolve them left-to-right while the point fades in.
const HEX = "0123456789ABCDEF";
const randHex = () => HEX[Math.floor(Math.random() * HEX.length)];
const scrambleChar = (c: string) => (/[a-zA-Z]/.test(c) ? randHex() : c);
const SCRAMBLE_SHUFFLE_MS = 70;

// Slow "breathing" envelope: a smooth 0..1 swell over BREATHE_PERIOD seconds.
// Drives the glow/backglow intensity so the heart feels warm and alive
// without any visible motion. tSeconds is wall-clock time in seconds.
const BREATHE_PERIOD = 5.5; // seconds per full swell-and-dim cycle
const breathing = (tSeconds: number) =>
  0.5 + 0.5 * Math.sin((tSeconds / BREATHE_PERIOD) * Math.PI * 2);

const heartXY = (t: number) => {
  // Heart equation:
  // x = 16 sin^3(t)
  // y = -(13 cos(t) - 5 cos(2t) - 2 cos(3t) - cos(4t))
  const x = 16 * Math.pow(Math.sin(t), 3);
  const y = -(
    13 * Math.cos(t) -
    5 * Math.cos(2 * t) -
    2 * Math.cos(3 * t) -
    Math.cos(4 * t)
  );
  return { x, y };
};

export default function TextHeart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let points: Point[] = [];
    const fontSize = 14;
    let cssWidth = 0;
    let cssHeight = 0;

    const initPoints = () => {
      points = [];
      const scale = Math.min(cssWidth, cssHeight) / 45;

      // Outline: "i love you" only — keeps a crisp heart silhouette.
      for (let t = 0; t < Math.PI * 2; t += 0.05) {
        const { x, y } = heartXY(t);
        const delay = Math.random() * 2000;
        points.push({
          offsetX: x * scale,
          offsetY: y * scale,
          alpha: 0,
          targetAlpha: 0.85 + Math.random() * 0.15,
          delay,
          text: OUTLINE_WORD,
          color: colorFor(OUTLINE_WORD),
          outline: true,
          fadingOut: false,
          scrambleStart: delay,
          scrambleDuration: 700 + Math.random() * 700,
          cachedDisplay: "",
          lastShuffleAt: 0,
        });
      }

      // Inner concentric layers: varied words.
      for (let s = 0.2; s < 1; s += 0.2) {
        for (let t = 0; t < Math.PI * 2; t += 0.1) {
          const { x, y } = heartXY(t);
          const word = pickInnerWord();
          const delay = Math.random() * 3000;
          points.push({
            offsetX: x * scale * s,
            offsetY: y * scale * s,
            alpha: 0,
            targetAlpha: 0.4 + Math.random() * 0.4,
            delay,
            text: word,
            color: colorFor(word),
            outline: false,
            fadingOut: false,
            scrambleStart: delay,
            scrambleDuration: 600 + Math.random() * 800,
            cachedDisplay: "",
            lastShuffleAt: 0,
          });
        }
      }
    };

    const resize = () => {
      // Hi-DPI: render at devicePixelRatio resolution, draw in CSS pixels.
      const dpr = window.devicePixelRatio || 1;
      cssWidth = window.innerWidth;
      cssHeight = window.innerHeight;
      canvas.width = Math.floor(cssWidth * dpr);
      canvas.height = Math.floor(cssHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initPoints();
    };

    let start: number | null = null;
    const draw = (time: number) => {
      if (!start) start = time;
      const elapsed = time - start;

      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.font = `${fontSize}px "Fira Code", monospace`;

      const centerX = cssWidth / 2;
      const centerY = cssHeight / 2;
      const scale = Math.min(cssWidth, cssHeight) / 45;

      // Slow breathing drives the glow + backglow intensity (0..1).
      const breathe = breathing(elapsed / 1000);

      // Ambient backglow: a soft radial pool of pink light behind the heart so
      // it sits in warmth instead of floating on pure black. Breathes too.
      const glowRadius = scale * 22;
      const gradient = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        glowRadius,
      );
      const glowAlpha = 0.07 + 0.05 * breathe;
      gradient.addColorStop(0, `rgba(${PINK}, ${glowAlpha})`);
      gradient.addColorStop(0.5, `rgba(${PINK}, ${glowAlpha * 0.4})`);
      gradient.addColorStop(1, `rgba(${PINK}, 0)`);
      ctx.shadowBlur = 0; // the gradient pool shouldn't cast its own shadow
      ctx.fillStyle = gradient;
      ctx.fillRect(centerX - glowRadius, centerY - glowRadius, glowRadius * 2, glowRadius * 2);

      // Particle birth/death: occasionally retire an inner point and respawn
      // it with a new word/color (and a fresh decode).
      if (elapsed > 6000 && Math.random() < 0.06) {
        const scan = 12;
        for (let i = 0; i < scan; i++) {
          const idx = Math.floor(Math.random() * points.length);
          const p = points[idx];
          if (!p.outline && !p.fadingOut && p.alpha > 0.3) {
            p.fadingOut = true;
            break;
          }
        }
      }

      for (const p of points) {
        if (p.fadingOut) {
          p.alpha += (0 - p.alpha) * 0.05;
          if (p.alpha < 0.04) {
            p.alpha = 0;
            const word = pickInnerWord();
            p.text = word;
            p.color = colorFor(word);
            p.targetAlpha = 0.4 + Math.random() * 0.4;
            p.fadingOut = false;
            // restart the glitch decode for the new word
            p.scrambleStart = elapsed;
            p.scrambleDuration = 600 + Math.random() * 800;
            p.cachedDisplay = "";
            p.lastShuffleAt = 0;
          }
        } else if (elapsed > p.delay) {
          p.alpha += (p.targetAlpha - p.alpha) * 0.02;
        }

        if (p.alpha <= 0.005 || elapsed < p.delay) continue;

        // Decide whether we're still in the scramble phase
        const localElapsed = elapsed - p.scrambleStart;
        let display: string;
        if (localElapsed < p.scrambleDuration) {
          const progress = localElapsed / p.scrambleDuration;
          const revealedCount = Math.floor(progress * p.text.length);
          if (elapsed - p.lastShuffleAt > SCRAMBLE_SHUFFLE_MS) {
            let out = "";
            for (let i = 0; i < p.text.length; i++) {
              out += i < revealedCount ? p.text[i] : scrambleChar(p.text[i]);
            }
            p.cachedDisplay = out;
            p.lastShuffleAt = elapsed;
          }
          display = p.cachedDisplay || p.text;
        } else {
          display = p.text;
        }

        const drawX = centerX + p.offsetX;
        const drawY = centerY + p.offsetY;

        // Soft bloom so the heart feels lit; the pink outline glows strongest
        // and the whole bloom swells/dims slowly with the breathing cycle.
        ctx.shadowColor = `rgba(${p.color}, ${Math.min(1, p.alpha + 0.2)})`;
        ctx.shadowBlur = (p.outline ? 12 : 6) + breathe * 5;
        ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
        ctx.fillText(display, drawX - ctx.measureText(display).width / 2, drawY);
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
      className="fixed inset-0 w-full h-full pointer-events-none"
    />
  );
}

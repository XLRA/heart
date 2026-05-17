"use client";

import { useEffect, useRef } from "react";

interface Point {
  x: number;
  y: number;
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

// Inner-fill word pool, weighted so the main message dominates and the
// other words sprinkle in as accents.
const INNER_WORDS = [
  "i love you",
  "baby",
  "beautiful",
  "gorgeous",
  "strawberry",
  "princess",
];
const INNER_WEIGHTS = [0.35, 0.13, 0.13, 0.13, 0.13, 0.13];

const pickInnerWord = () => {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < INNER_WORDS.length; i++) {
    acc += INNER_WEIGHTS[i];
    if (r < acc) return INNER_WORDS[i];
  }
  return INNER_WORDS[0];
};

// Only the main "i love you" message is pink; the rest render white.
const PINK = "255, 77, 109";
const WHITE = "255, 255, 255";
const colorFor = (word: string) => (word === "i love you" ? PINK : WHITE);

// Glitch-decode helpers — scramble each letter through random hex chars
// and resolve them left-to-right while the point fades in.
const HEX = "0123456789ABCDEF";
const randHex = () => HEX[Math.floor(Math.random() * HEX.length)];
const scrambleChar = (c: string) => (/[a-zA-Z]/.test(c) ? randHex() : c);
const SCRAMBLE_SHUFFLE_MS = 70;

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
      const centerX = cssWidth / 2;
      const centerY = cssHeight / 2;
      const scale = Math.min(cssWidth, cssHeight) / 45;

      // Outline: "i love you, rin" only — keeps a crisp heart silhouette.
      for (let t = 0; t < Math.PI * 2; t += 0.05) {
        const { x, y } = heartXY(t);
        const delay = Math.random() * 2000;
        points.push({
          x: centerX + x * scale,
          y: centerY + y * scale,
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
            x: centerX + x * scale * s,
            y: centerY + y * scale * s,
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

        ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
        ctx.fillText(display, p.x - ctx.measureText(display).width / 2, p.y);
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

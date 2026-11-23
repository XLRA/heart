'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './BlackwallLanding.module.css';
import { type BlackwallHandle, createBlackwall } from './engine';

/* ──────────────────────────────────────────────────────────────
   Blackwall landing — mount point.

   The page is a black void and one canvas. No text: everything
   visible is drawn by the WebGL2 engine in engine.ts. This component
   owns the canvas element's lifetime — the engine is created on
   mount and fully torn down on unmount — and one small control, the
   sound toggle in the corner. Sound is on by default but a browser
   only lets it start on the visitor's first click or key press.

   If WebGL2 is unavailable, or a shader fails to build, the engine
   returns null and the page stays what it is underneath: #000000.
   ────────────────────────────────────────────────────────────── */

export default function BlackwallLanding() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<BlackwallHandle | null>(null);
  const [soundOn, setSoundOn] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = createBlackwall(canvas);
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle?.dispose();
    };
  }, []);

  function toggleSound(): void {
    const next = !soundOn;
    setSoundOn(next);
    handleRef.current?.setAudio(next);
  }

  return (
    <main className={styles.root}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden />
      <button
        type="button"
        className={styles.sound}
        onClick={toggleSound}
        aria-pressed={soundOn}
        aria-label={soundOn ? 'Mute sound' : 'Unmute sound'}
        title={soundOn ? 'Mute sound' : 'Unmute sound'}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden focusable="false">
          <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" />
          {soundOn ? (
            <path
              d="M15.2 9.2a4 4 0 0 1 0 5.6M17.6 6.8a7.4 7.4 0 0 1 0 10.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="square"
            />
          ) : (
            <path
              d="M15.4 9.4l5 5.2M20.4 9.4l-5 5.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="square"
            />
          )}
        </svg>
      </button>
    </main>
  );
}

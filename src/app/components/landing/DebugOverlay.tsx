'use client';

/* ──────────────────────────────────────────────────────────────
   Dev-only performance overlay.

   Activated by appending `?debug` to the URL. Shows FPS, drop
   count, active strikes/flashes, and current sheet state. Reads
   metrics from a shared ref the rAF loop writes into, so the
   overlay re-renders at 4 Hz independently of the canvas tick.

   Zero-cost when inactive — the component returns null without
   ever subscribing to anything.
   ────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';

export interface DebugMetrics {
  fps: number;
  drops: number;
  /** Applied rain density factor (perf governor × lifecycle). */
  rainDensity: number;
  /** Storm lifecycle intensity 0..1 (0 = drizzle, 1 = peak). */
  lifecycle: number;
  adHocStrikes: number;
  bgFlashes: number;
  windSheetActive: boolean;
  windSheetIntensity: number;
}

export type DebugMetricsRef = { current: DebugMetrics };

export function createDebugMetrics(): DebugMetrics {
  return {
    fps: 0,
    drops: 0,
    rainDensity: 1,
    lifecycle: 0,
    adHocStrikes: 0,
    bgFlashes: 0,
    windSheetActive: false,
    windSheetIntensity: 0,
  };
}

export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('debug');
}

interface Props {
  metricsRef: DebugMetricsRef;
}

export default function DebugOverlay({ metricsRef }: Props) {
  const [snapshot, setSnapshot] = useState<DebugMetrics>(() =>
    createDebugMetrics(),
  );
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      setSnapshot({ ...metricsRef.current });
    }, 250);
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [metricsRef]);

  const fpsColor =
    snapshot.fps >= 58
      ? '#7eff8d'
      : snapshot.fps >= 45
        ? '#ffd87a'
        : '#ff7a7a';

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 1000,
        padding: '10px 12px',
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        fontSize: 11,
        lineHeight: 1.55,
        color: '#e6e6e6',
        background: 'rgba(0, 0, 0, 0.55)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 6,
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        pointerEvents: 'none',
        userSelect: 'none',
        minWidth: 130,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ opacity: 0.6 }}>fps</span>
        <span style={{ color: fpsColor, fontVariantNumeric: 'tabular-nums' }}>
          {snapshot.fps.toFixed(0)}
        </span>
      </div>
      <Row label="drops" value={snapshot.drops} />
      <Row label="density" value={snapshot.rainDensity.toFixed(2)} />
      <Row label="storm" value={snapshot.lifecycle.toFixed(2)} />
      <Row label="strikes" value={snapshot.adHocStrikes} />
      <Row label="bg flashes" value={snapshot.bgFlashes} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 4,
          paddingTop: 4,
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span style={{ opacity: 0.6 }}>sheet</span>
        <span
          style={{
            color: snapshot.windSheetActive ? '#7eff8d' : 'rgba(255,255,255,0.4)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {snapshot.windSheetActive
            ? snapshot.windSheetIntensity.toFixed(2)
            : '—'}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

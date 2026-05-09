'use client';

import Link from 'next/link';
import styles from './StormLanding.module.css';

/**
 * Hand-tuned jagged paths for the lightning strike.
 * ViewBox is 1600x1000; preserveAspectRatio="none" lets it span
 * corner-to-corner regardless of the actual viewport ratio.
 * pathLength="1" normalizes length so stroke-dash animations
 * don't depend on the real path length.
 */
const MAIN_BOLT =
  'M 1585 15 L 1440 145 L 1495 240 L 1305 320 L 1380 430 L 1180 500 L 1245 635 ' +
  'L 980 690 L 1045 800 L 780 815 L 850 920 L 545 905 L 380 970 L 205 940 L 60 990';

const BRANCHES = [
  'M 1305 320 L 1205 365 L 1235 445',
  'M 1180 500 L 1080 565 L 1130 660',
  'M 980 690 L 880 720 L 920 800',
  'M 545 905 L 460 970',
];

export default function StormLanding() {
  return (
    <main className={styles.scene}>
      {/* Atmospheric storm sky */}
      <div className={styles.sky} aria-hidden />
      <div className={styles.cloudA} aria-hidden />
      <div className={styles.cloudB} aria-hidden />
      <div className={styles.cloudC} aria-hidden />

      {/* Pre-flicker (leader stroke) */}
      <div className={styles.preflicker} aria-hidden />

      {/* The strike */}
      <svg
        className={styles.lightning}
        viewBox="0 0 1600 1000"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          d={MAIN_BOLT}
          pathLength={1}
          className={`${styles.bolt} ${styles.boltGlow}`}
        />
        <path
          d={MAIN_BOLT}
          pathLength={1}
          className={`${styles.bolt} ${styles.boltMid}`}
        />
        <path
          d={MAIN_BOLT}
          pathLength={1}
          className={`${styles.bolt} ${styles.boltCore}`}
        />

        {BRANCHES.map((d, i) => (
          <g key={i}>
            <path
              d={d}
              pathLength={1}
              className={`${styles.branch} ${styles.branchGlow}`}
            />
            <path
              d={d}
              pathLength={1}
              className={`${styles.branch} ${styles.branchCore}`}
            />
          </g>
        ))}
      </svg>

      {/* Reveal flash */}
      <div className={styles.flash} aria-hidden />

      {/* Filmic grain + vignette sit on top of the sky but under the wordmark */}
      <div className={styles.grain} aria-hidden />
      <div className={styles.vignette} aria-hidden />

      {/* Stage: wordmark + tagline */}
      <div className={styles.stage}>
        <h1 className={styles.wordmark}>sleep</h1>
        <p className={styles.tagline}>where do we go from here?</p>
      </div>

      {/* Subtle corner marks */}
      <span className={`${styles.cornerMark} ${styles.cornerTL}`}>v.0</span>
      <span className={`${styles.cornerMark} ${styles.cornerBL}`}>est. 2025</span>

      <Link href="/music" className={styles.musicLink}>
        music
      </Link>
    </main>
  );
}

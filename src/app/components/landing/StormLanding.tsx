'use client';

import Link from 'next/link';
import styles from './StormLanding.module.css';
import { generateLightning } from './generateBolt';

/**
 * Lightning is generated once at module load via midpoint
 * displacement (see generateBolt.ts). Source/dest are roughly
 * vertical with a slight diagonal lean so the bolt cuts down
 * the middle of the page rather than sitting in a corner.
 *
 * Seed is fixed so the bolt shape is stable across renders
 * and matches between server and client (no hydration drift).
 * Change the seed to roll a different strike geometry.
 */
const { mainPath, branches } = generateLightning(
  19,                  // seed — try different ints for different bolt shapes
  [880, -40],          // source: above the top, slightly right of center
  [700, 1040],         // dest:   below the bottom, slightly left of center
);

export default function StormLanding() {
  return (
    <main className={styles.scene}>
      <div className={styles.sky} aria-hidden />
      <div className={styles.haze} aria-hidden />
      <div className={styles.horizon} aria-hidden />
      <div className={styles.preflicker} aria-hidden />
      <div className={styles.flash} aria-hidden />

      <svg
        className={styles.lightning}
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        {/* Each path stacks 4 stroke layers: outer purple haze, lavender
            halo, bright mid, pure-white hairline core. */}
        <path d={mainPath} className={styles.boltOuter} />
        <path d={mainPath} className={styles.boltHalo} />
        <path d={mainPath} className={styles.boltMid} />
        <path d={mainPath} className={styles.boltCore} />

        {branches.map((d, i) => (
          <g key={i}>
            <path d={d} className={styles.branchHalo} />
            <path d={d} className={styles.branchMid} />
            <path d={d} className={styles.branchCore} />
          </g>
        ))}
      </svg>

      <div className={styles.grain} aria-hidden />
      <div className={styles.vignette} aria-hidden />

      <div className={styles.stage}>
        <h1 className={styles.wordmark}>sleep</h1>
        <p className={styles.tagline}>where do we go from here</p>
      </div>

      <div className={`${styles.corner} ${styles.cornerTL}`}>
        <span className={styles.dot} />
        sleeep.dev
      </div>

      <div className={`${styles.corner} ${styles.cornerTR}`}>
        n 40.7 / w 74.0
      </div>

      <div className={`${styles.corner} ${styles.cornerBL}`}>
        mmxxv
      </div>

      <Link href="/music" className={styles.musicLink}>
        music
      </Link>
    </main>
  );
}

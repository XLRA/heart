'use client';

import Link from 'next/link';
import styles from './StormLanding.module.css';

/**
 * Lightning path geometry.
 *
 * - viewBox 1600x1000, preserveAspectRatio="none" so the bolt
 *   spans the viewport corner-to-corner regardless of ratio.
 * - The main trunk has ~30 nodes with intentionally irregular
 *   segment lengths and sharp angles — real lightning is not
 *   a smooth zigzag, it travels in straight ionized segments
 *   with abrupt direction changes.
 * - 17 branches of varying length sprout from the trunk; some
 *   fork further, some end almost immediately. Real strikes
 *   have dozens of micro-branches.
 */
const MAIN_BOLT =
  'M 1590 5 L 1530 65 L 1555 115 L 1485 145 L 1500 195 L 1440 215 ' +
  'L 1465 270 L 1395 290 L 1410 340 L 1340 365 L 1380 415 L 1295 435 ' +
  'L 1325 490 L 1245 510 L 1280 565 L 1190 585 L 1215 635 L 1135 650 ' +
  'L 1165 700 L 1075 720 L 1100 770 L 1010 785 L 1040 835 L 940 850 ' +
  'L 905 880 L 800 895 L 760 920 L 645 930 L 540 950 L 425 960 ' +
  'L 320 975 L 215 985 L 110 995 L 35 1000';

const BRANCHES: string[] = [
  'M 1485 145 L 1455 175 L 1465 215',
  'M 1500 195 L 1545 225 L 1530 270',
  'M 1395 290 L 1365 325 L 1380 365',
  'M 1340 365 L 1310 405 L 1320 445',
  'M 1295 435 L 1265 470 L 1280 515',
  'M 1245 510 L 1205 540 L 1220 580',
  'M 1190 585 L 1165 615 L 1180 655',
  'M 1135 650 L 1095 685 L 1110 720',
  'M 1075 720 L 1115 740',
  'M 1075 720 L 1045 750 L 1060 790',
  'M 940 850 L 905 880 L 925 920',
  'M 800 895 L 770 925 L 780 960',
  'M 645 930 L 600 970',
  'M 540 950 L 500 980 L 510 1000',
  'M 1410 340 L 1430 380',
  'M 1010 785 L 1030 820',
  'M 320 975 L 295 1000',
];

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
        preserveAspectRatio="none"
        aria-hidden
      >
        {/*
          Each path is rendered four times as stacked stroke layers
          for the white-violet halo look.
          Order matters: outermost first so the core sits on top.
        */}
        <path d={MAIN_BOLT} className={styles.boltOuter} />
        <path d={MAIN_BOLT} className={styles.boltHalo} />
        <path d={MAIN_BOLT} className={styles.boltMid} />
        <path d={MAIN_BOLT} className={styles.boltCore} />

        {BRANCHES.map((d, i) => (
          <g key={i}>
            <path d={d} className={styles.branchHalo} />
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

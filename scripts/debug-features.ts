/** 调试：按真值类别输出特征分布（均值/分位），用于标定阈值 */
import { simulateTray } from '../src/sim/generator';
import { detectGrid, extractFeaturesCpu } from '../src/analysis/features';
import { FEATURE_COUNT, F } from '../src/types';

const ROWS = 10, COLS = 15;
const names = Object.entries(F).map(([k, v]) => [v, k] as const).sort((a, b) => a[0] - b[0]).map(([, k]) => k);

const byClass: Record<string, number[][]> = {};
const crackFeats: number[][] = [];
const noCrackFeats: number[][] = [];

for (let t = 0; t < 8; t++) {
  const day = 5 + (t % 5);
  const sim = simulateTray({
    rows: ROWS, cols: COLS, day, seed: 1000 + t * 77,
    fertility: 0.9, earlyDeadRate: 0.05, lateDeadRate: 0.04, crackRate: 0.08,
  });
  const grid = detectGrid(sim.lum, sim.width, sim.height, ROWS, COLS);
  const feats = extractFeaturesCpu(sim.lum, sim.width, sim.height, grid);
  for (let i = 0; i < sim.truth.length; i++) {
    const row = Array.from(feats.slice(i * FEATURE_COUNT, (i + 1) * FEATURE_COUNT));
    const tr = sim.truth[i];
    (byClass[tr.label] ||= []).push(row);
    (tr.crack ? crackFeats : noCrackFeats).push(row);
  }
}

function stats(rows: number[][], fi: number) {
  const v = rows.map((r) => r[fi]).sort((a, b) => a - b);
  const q = (p: number) => v[Math.floor(v.length * p)].toFixed(4);
  return `p5=${q(0.05)} p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)} p95=${q(0.95)}`;
}

const interesting = [F.DARK, F.VDARK, F.INNER_DARK, F.ANN_DARK, F.RING, F.VESSEL, F.DOT, F.SPREAD, F.MEAN, F.BASE, F.ABS_DARK, F.CRACK_SIDE, F.CRACK_P99, F.CRACK_MAX, F.CRACK_LEN];
for (const cls of Object.keys(byClass)) {
  console.log(`\n### ${cls} (n=${byClass[cls].length})`);
  for (const fi of interesting) console.log(`  ${names[fi].padEnd(10)} ${stats(byClass[cls], fi)}`);
}
console.log(`\n### crack=true (n=${crackFeats.length})`);
for (const fi of [F.CRACK_P99, F.CRACK_MAX, F.CRACK_LEN]) console.log(`  ${names[fi].padEnd(10)} ${stats(crackFeats, fi)}`);
console.log(`### crack=false (n=${noCrackFeats.length})`);
for (const fi of [F.CRACK_P99, F.CRACK_MAX, F.CRACK_LEN]) console.log(`  ${names[fi].padEnd(10)} ${stats(noCrackFeats, fi)}`);

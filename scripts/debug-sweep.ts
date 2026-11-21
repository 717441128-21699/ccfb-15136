/** 裂纹阈值扫描：不同 P99 门限下的检出率/误报率 */
import { simulateTray } from '../src/sim/generator';
import { detectGrid, extractFeaturesCpu } from '../src/analysis/features';
import { TH } from '../src/analysis/classify';
import { FEATURE_COUNT, F } from '../src/types';

const ROWS = 10, COLS = 15;
let crackTruth = 0;
const hits: number[] = [];
const fps: number[] = [];
const ths = [0.06, 0.08, 0.10, 0.12, 0.14, 0.16];
for (const _ of ths) { hits.push(0); fps.push(0); }
let totalNoCrack = 0;

for (let t = 0; t < 10; t++) {
  const sim = simulateTray({
    rows: ROWS, cols: COLS, day: 5 + (t % 5), seed: 2000 + t * 31,
    fertility: 0.9, earlyDeadRate: 0.05, lateDeadRate: 0.04, crackRate: 0.08,
  });
  const grid = detectGrid(sim.lum, sim.width, sim.height, ROWS, COLS);
  const feats = extractFeaturesCpu(sim.lum, sim.width, sim.height, grid);
  for (let i = 0; i < sim.truth.length; i++) {
    const o = i * FEATURE_COUNT;
    const p99 = feats[o + F.CRACK_P99];
    const side = feats[o + F.CRACK_SIDE];
    const len = feats[o + F.CRACK_LEN];
    const base = feats[o + F.BASE];
    const truthCrack = sim.truth[i].crack;
    if (truthCrack) crackTruth++; else totalNoCrack++;
    ths.forEach((th, k) => {
      const flag = p99 > th && side > base - TH.crackSideMargin && len > TH.crackMinLen;
      if (flag && truthCrack) hits[k]++;
      if (flag && !truthCrack) fps[k]++;
    });
  }
}
console.log(`裂纹蛋 ${crackTruth}，无裂纹蛋 ${totalNoCrack}`);
for (let k = 0; k < ths.length; k++) {
  console.log(`P99>${ths[k].toFixed(2)}: 检出 ${((hits[k] / crackTruth) * 100).toFixed(1)}%  误报 ${((fps[k] / totalNoCrack) * 100).toFixed(2)}% (${fps[k]})`);
}

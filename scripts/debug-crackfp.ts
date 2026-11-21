/** 调试：裂纹误报分解 —— 按类别看 SIDE/P99/LEN 分布与误报数 */
import { simulateTray } from '../src/sim/generator';
import { detectGrid, extractFeaturesCpu } from '../src/analysis/features';
import { classifyEgg, TH } from '../src/analysis/classify';
import { FEATURE_COUNT, F } from '../src/types';

const ROWS = 10, COLS = 15;
const fpByClass: Record<string, number> = {};
const nByClass: Record<string, number> = {};
const sideVals: number[] = [];
const p99Vals: number[] = [];

for (let t = 0; t < 8; t++) {
  const sim = simulateTray({
    rows: ROWS, cols: COLS, day: 5 + (t % 5), seed: 1000 + t * 77,
    fertility: 0.9, earlyDeadRate: 0.05, lateDeadRate: 0.04, crackRate: 0.0, // 全部无裂纹，统计纯误报
  });
  const grid = detectGrid(sim.lum, sim.width, sim.height, ROWS, COLS);
  const feats = extractFeaturesCpu(sim.lum, sim.width, sim.height, grid);
  for (let i = 0; i < sim.truth.length; i++) {
    const tr = sim.truth[i];
    nByClass[tr.label] = (nByClass[tr.label] || 0) + 1;
    const o = i * FEATURE_COUNT;
    const v = classifyEgg(feats, o, 7);
    if (v.crack) {
      fpByClass[tr.label] = (fpByClass[tr.label] || 0) + 1;
      sideVals.push(feats[o + F.CRACK_SIDE]);
      p99Vals.push(feats[o + F.CRACK_P99]);
    }
  }
}
console.log('误报按类别:', fpByClass);
console.log('各类总数:', nByClass);
console.log('SIDE 门限: B -', TH.crackSideMargin);
if (sideVals.length) {
  sideVals.sort((a, b) => a - b);
  p99Vals.sort((a, b) => a - b);
  const q = (a: number[], p: number) => a[Math.floor(a.length * p)].toFixed(3);
  console.log(`误报蛋 SIDE: p10=${q(sideVals, 0.1)} p50=${q(sideVals, 0.5)} p90=${q(sideVals, 0.9)}`);
  console.log(`误报蛋 P99 : p10=${q(p99Vals, 0.1)} p50=${q(p99Vals, 0.5)} p90=${q(p99Vals, 0.9)}`);
}

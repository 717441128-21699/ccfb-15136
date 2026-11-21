/**
 * 指标自检：合成 N 盘带真值的照蛋图 → CPU 特征提取 → 判别 → 输出
 *   四类判别一致率（对合成真值）、裂纹检出率/误报率、单盘耗时。
 * 运行：npm run validate
 */
import { simulateTray } from '../src/sim/generator';
import { detectGrid, extractFeaturesCpu } from '../src/analysis/features';
import { classifyEgg } from '../src/analysis/classify';
import { CLASSES, CLASS_NAMES, EggClass, FEATURE_COUNT } from '../src/types';

declare const process: { exit(code: number): void };

const TRAYS = 16;
const ROWS = 10, COLS = 15;

interface Conf {
  [k: string]: number;
}

const conf: Conf = {};
let totalEggs = 0, agree = 0;
let crackTruth = 0, crackHit = 0, crackFalse = 0;
let totalMs = 0;
const perClassTruth: Conf = {};
const perClassHit: Conf = {};

for (let t = 0; t < TRAYS; t++) {
  const day = 5 + (t % 5); // 5~9 胚龄轮换
  const sim = simulateTray({
    rows: ROWS,
    cols: COLS,
    day,
    seed: 1000 + t * 77,
    fertility: [0.95, 0.93, 0.84, 0.91][t % 4],
    earlyDeadRate: 0.025,
    lateDeadRate: 0.015,
    crackRate: 0.05,
  });
  const t0 = performance.now();
  const grid = detectGrid(sim.lum, sim.width, sim.height, ROWS, COLS);
  const feats = extractFeaturesCpu(sim.lum, sim.width, sim.height, grid);
  const ms = performance.now() - t0;
  totalMs += ms;

  for (let i = 0; i < sim.truth.length; i++) {
    const truth = sim.truth[i];
    const v = classifyEgg(feats, i * FEATURE_COUNT, day);
    totalEggs++;
    perClassTruth[truth.label] = (perClassTruth[truth.label] || 0) + 1;
    const key = `${truth.label}->${v.label}`;
    conf[key] = (conf[key] || 0) + 1;
    if (v.label === truth.label) {
      agree++;
      perClassHit[truth.label] = (perClassHit[truth.label] || 0) + 1;
    }
    if (truth.crack) {
      crackTruth++;
      if (v.crack) crackHit++;
    } else if (v.crack) crackFalse++;
  }
}

console.log(`\n=== 照蛋分析指标自检（CPU 管线，${TRAYS} 盘 × ${ROWS * COLS} 枚）===`);
console.log(`总蛋数: ${totalEggs}`);
console.log(`四类判别一致率: ${((agree / totalEggs) * 100).toFixed(2)}%  (目标 ≥95%)`);
console.log(`裂纹检出率: ${crackTruth ? ((crackHit / crackTruth) * 100).toFixed(2) : '-'}% (${crackHit}/${crackTruth})  (目标 ≥90%)`);
console.log(`裂纹误报: ${crackFalse} 枚 (${((crackFalse / (totalEggs - crackTruth)) * 100).toFixed(2)}%)`);
console.log(`单盘平均耗时: ${(totalMs / TRAYS).toFixed(0)} ms  (目标 <1500 ms)`);
console.log('\n分类别召回率:');
for (const c of CLASSES) {
  const n = perClassTruth[c] || 0;
  const hit = perClassHit[c] || 0;
  console.log(`  ${CLASS_NAMES[c as EggClass]}: ${n ? ((hit / n) * 100).toFixed(1) : '-'}% (${hit}/${n})`);
}
console.log('\n混淆矩阵（真值 -> 判别）:');
for (const k of Object.keys(conf).sort()) {
  const [a, b] = k.split('->');
  if (a !== b) console.log(`  ${CLASS_NAMES[a as EggClass]} -> ${CLASS_NAMES[b as EggClass]}: ${conf[k]}`);
}

const okAgree = agree / totalEggs >= 0.95;
const okCrack = crackTruth === 0 || crackHit / crackTruth >= 0.9;
const okTime = totalMs / TRAYS < 1500;
if (okAgree && okCrack && okTime) {
  console.log('\n✔ 全部指标达标');
} else {
  console.log(`\n✘ 未达标: 一致率${okAgree ? '✔' : '✘'} 裂纹${okCrack ? '✔' : '✘'} 耗时${okTime ? '✔' : '✘'}`);
  process.exit(1);
}

/**
 * 分析执行器：蛋盘 → 亮度图 → 网格 → 特征 → 判别 → 落库。
 * 合成盘按种子确定性重生成（图片不入库）；导入图仅存内存。
 */
import { simulateTray, SimTray } from '../sim/generator';
import { detectGrid } from './features';
import { extractFeatures } from '../gpu/pipeline';
import { classifyEgg } from './classify';
import { batchOf, houseOf, saveResult } from '../store';
import { EggResultRec, FEATURE_COUNT, Tray, TrayResult, TrayStats } from '../types';

const simCache = new Map<string, SimTray>();
const importCache = new Map<string, { lum: Float32Array; rgba: Uint8ClampedArray; width: number; height: number }>();

export interface TrayImage {
  lum: Float32Array;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  truth?: { label: TrayResult['eggs'][0]['label']; crack: boolean }[];
}

export function getTrayImage(tray: Tray): TrayImage {
  if (tray.imported) {
    const img = importCache.get(tray.id);
    if (!img) throw new Error('导入图片仅保存在内存中，请重新导入');
    return img;
  }
  let sim = simCache.get(tray.id);
  if (!sim) {
    const batch = batchOf(tray);
    const house = batch ? houseOf(batch) : undefined;
    sim = simulateTray({
      rows: tray.rows,
      cols: tray.cols,
      day: batch?.day ?? 7,
      seed: tray.seed,
      fertility: house?.baseFertility ?? 0.92,
      earlyDeadRate: 0.025,
      lateDeadRate: 0.015,
      crackRate: 0.05,
    });
    simCache.set(tray.id, sim);
  }
  return { lum: sim.lum, rgba: sim.rgba, width: sim.width, height: sim.height, truth: sim.truth };
}

export function trayHasTruth(tray: Tray): boolean {
  return !tray.imported;
}

/** 导入外部照片（File → ImageData → 亮度） */
export async function importImage(tray: Tray, file: File): Promise<TrayImage> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  // 限制最长边，控制计算量
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const lum = new Float32Array(data.width * data.height);
  for (let i = 0; i < lum.length; i++) {
    lum[i] =
      (data.data[i * 4] * 0.299 + data.data[i * 4 + 1] * 0.587 + data.data[i * 4 + 2] * 0.114) / 255;
  }
  const img = { lum, rgba: data.data, width: data.width, height: data.height };
  importCache.set(tray.id, img);
  return img;
}

export function analyzeTray(tray: Tray): TrayResult {
  const img = getTrayImage(tray);
  const t0 = performance.now();
  const grid = detectGrid(img.lum, img.width, img.height, tray.rows, tray.cols);
  const { features, engine } = extractFeatures(img.lum, img.width, img.height, grid);
  const batch = batchOf(tray);
  const day = batch?.day ?? 7;
  const eggs: EggResultRec[] = [];
  const stats: TrayStats = {
    total: 0, fertile: 0, clear: 0, earlyDead: 0, lateDead: 0, cracks: 0, fertileRate: 0,
  };
  const n = tray.rows * tray.cols;
  for (let i = 0; i < n; i++) {
    const v = classifyEgg(features, i * FEATURE_COUNT, day);
    eggs.push({ label: v.label, crack: v.crack, confidence: v.confidence });
    stats.total++;
    stats[v.label]++;
    if (v.crack) stats.cracks++;
  }
  stats.fertileRate = stats.fertile / Math.max(1, stats.total);
  const result: TrayResult = {
    trayId: tray.id,
    engine,
    durationMs: Math.round(performance.now() - t0),
    analyzedAt: Date.now(),
    eggs,
    stats,
  };
  saveResult(result);
  return result;
}

/** 供界面显示网格（与分析同一定位） */
export function gridOf(img: TrayImage, tray: Tray) {
  return detectGrid(img.lum, img.width, img.height, tray.rows, tray.cols);
}

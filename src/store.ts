/** localStorage 持久化：批次/蛋盘/分析结果/复核记录 */
import { Batch, Db, EggResultRec, House, ReviewRec, Tray, TrayResult } from './types';

const KEY = 'candling.db.v1';

function blank(): Db {
  return { houses: [], batches: [], trays: [], results: {}, reviews: [] };
}

let cache: Db | null = null;

export function loadDb(): Db {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      cache = JSON.parse(raw) as Db;
      return cache;
    }
  } catch {
    /* 损坏则重建 */
  }
  cache = blank();
  seed(cache);
  save();
  return cache;
}

export function save() {
  if (!cache) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('存储失败（可能超出 localStorage 配额）', e);
  }
}

export function resetDb() {
  cache = blank();
  seed(cache);
  save();
}

function seed(db: Db) {
  // 四个种鸡舍；三种舍基准受精率偏低，用于演示"低受精率追溯到舍"
  db.houses = [
    { id: 'h1', name: '一种舍', baseFertility: 0.95 },
    { id: 'h2', name: '二种舍', baseFertility: 0.93 },
    { id: 'h3', name: '三种舍', baseFertility: 0.84 },
    { id: 'h4', name: '四种舍', baseFertility: 0.91 },
  ];
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ---------- 批次 ----------
export function addBatch(b: Omit<Batch, 'id' | 'createdAt'>): Batch {
  const db = loadDb();
  const batch: Batch = { ...b, id: uid('b'), createdAt: Date.now() };
  db.batches.push(batch);
  // 自动建盘
  for (let i = 1; i <= b.trayCount; i++) {
    db.trays.push({
      id: uid('t'),
      batchId: batch.id,
      index: i,
      rows: 10,
      cols: 15,
      seed: (hashCode(batch.id) + i * 7919) >>> 0,
      imported: false,
      createdAt: Date.now(),
    });
  }
  save();
  return batch;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

export function houseOf(batch: Batch): House | undefined {
  return loadDb().houses.find((h) => h.id === batch.houseId);
}

export function traysOf(batchId: string): Tray[] {
  return loadDb()
    .trays.filter((t) => t.batchId === batchId)
    .sort((a, b) => a.index - b.index);
}

export function batchOf(tray: Tray): Batch | undefined {
  return loadDb().batches.find((b) => b.id === tray.batchId);
}

// ---------- 结果 ----------
export function saveResult(r: TrayResult) {
  const db = loadDb();
  db.results[r.trayId] = r;
  save();
}

export function resultOf(trayId: string): TrayResult | undefined {
  return loadDb().results[trayId];
}

// ---------- 复核 ----------
export function saveReview(rec: ReviewRec) {
  const db = loadDb();
  const i = db.reviews.findIndex((r) => r.trayId === rec.trayId && r.eggIndex === rec.eggIndex);
  if (i >= 0) db.reviews[i] = rec;
  else db.reviews.push(rec);
  save();
}

export function reviewsOf(trayId: string): ReviewRec[] {
  return loadDb().reviews.filter((r) => r.trayId === trayId);
}

/** 复核修正后的有效结果（统计页/追溯用） */
export function effectiveEggs(trayId: string): EggResultRec[] {
  const db = loadDb();
  const res = db.results[trayId];
  if (!res) return [];
  const eggs = res.eggs.map((e) => ({ ...e }));
  for (const r of db.reviews) {
    if (r.trayId !== trayId) continue;
    if (r.humanLabel) eggs[r.eggIndex].label = r.humanLabel;
    if (r.humanCrack !== null) eggs[r.eggIndex].crack = r.humanCrack;
  }
  return eggs;
}

/** 全局共享类型 */

export type EggClass = 'fertile' | 'clear' | 'earlyDead' | 'lateDead';

export const CLASS_NAMES: Record<EggClass, string> = {
  fertile: '受精',
  clear: '无精',
  earlyDead: '早死胚',
  lateDead: '晚死胚',
};

export const CLASS_COLORS: Record<EggClass, string> = {
  fertile: '#3fb950',
  clear: '#c9a227',
  earlyDead: '#e07b39',
  lateDead: '#d64545',
};

export const CLASSES: EggClass[] = ['fertile', 'clear', 'earlyDead', 'lateDead'];

/** 每蛋 16 维特征（CPU 与 WebGL2 两条管线严格同构） */
export const F = {
  MEAN: 0,        // 蛋体内部绝对亮度均值
  BASE: 1,        // 每蛋基线 B：壳亮区环带(0.70~0.88R)均值
  DARK: 2,        // 暗像素占比（lum < B-0.10）
  VDARK: 3,       // 深暗像素占比（lum < min(B-0.20, 0.40)）
  INNER_DARK: 4,  // 内核区(r<0.38R)暗像素占比
  ANN_DARK: 5,    // 中环区(0.45~0.70R)暗像素占比 —— 血环带
  RING: 6,        // 血环对比 = ANN_DARK - INNER_DARK
  VESSEL: 7,      // 内核区(r<0.45R)细暗线像素占比（血管网响应）
  DOT: 8,         // 胚胎点响应（8px 环绕均值 - 3px 中心均值 的最大值）
  CRACK_MAX: 9,   // 裂纹线滤波最大响应
  CRACK_P99: 10,  // 裂纹线滤波 99.5% 分位
  CRACK_LEN: 11,  // 裂纹响应超阈像素占比
  CENTR: 12,      // 暗质心偏移 / R
  SPREAD: 13,     // 暗区二阶矩 / R²（阴影弥散度）
  CRACK_SIDE: 14, // 裂纹高响应像素处的两侧亮度均值（裂纹两侧≈壳面，血管间隙两侧≈暗线）
  ABS_DARK: 15,   // 绝对深暗像素占比（lum < 0.32，晚死胚整蛋变暗）
} as const;

export const FEATURE_COUNT = 16;

export interface Grid {
  rows: number;
  cols: number;
  cellW: number;
  cellH: number;
  /** 逐列/逐行精化后的蛋中心（抗投影漂移） */
  cx: Float32Array;
  cy: Float32Array;
}

export interface EggVerdict {
  label: EggClass;
  crack: boolean;
  /** 0~1，规则判据的裕度换算 */
  confidence: number;
}

export interface TrayStats {
  total: number;
  fertile: number;
  clear: number;
  earlyDead: number;
  lateDead: number;
  cracks: number;
  fertileRate: number;
}

export interface House {
  id: string;
  name: string;
  /** 该舍基准受精率（合成数据用） */
  baseFertility: number;
}

export interface Batch {
  id: string;
  code: string;
  houseId: string;
  setDate: string; // ISO 日期
  day: number;     // 照蛋胚龄，默认 7
  trayCount: number;
  notes: string;
  createdAt: number;
}

export interface SimTruth {
  label: EggClass;
  crack: boolean;
}

export interface Tray {
  id: string;
  batchId: string;
  index: number;      // 盘号，从 1 开始
  rows: number;
  cols: number;
  seed: number;       // 合成图种子（导入图为 0）
  imported: boolean;  // 是否人工导入图片（图片不持久化）
  createdAt: number;
}

export interface EggResultRec {
  label: EggClass;
  crack: boolean;
  confidence: number;
}

export interface TrayResult {
  trayId: string;
  engine: 'webgl2' | 'cpu';
  durationMs: number;
  analyzedAt: number;
  eggs: EggResultRec[];
  stats: TrayStats;
}

export interface ReviewRec {
  trayId: string;
  eggIndex: number;
  machine: EggResultRec;
  humanLabel: EggClass | null;
  humanCrack: boolean | null;
  reviewedAt: number;
}

export interface Db {
  houses: House[];
  batches: Batch[];
  trays: Tray[];
  results: Record<string, TrayResult>;
  reviews: ReviewRec[];
}

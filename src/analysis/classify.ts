/**
 * 判别器：16 维特征 → 四类判别 + 裂纹标志。
 * 规则阈值按 5~9 胚龄合成照蛋图标定（实测分布见 scripts/debug-features.ts，
 * 指标见 scripts/validate.ts）。
 */
import { EggClass, EggVerdict, F } from '../types';

export const TH = {
  // 晚死胚：整蛋透光差（绝对亮度）
  meanLate: 0.5,
  // 早死胚：血环（中环暗、内核相对亮）
  ringEarly: 0.03,
  annEarly: 0.045,
  // 受精：胚胎点（8px 环绕 - 3px 中心）
  dotFertile: 0.09,
  // 裂纹：亮线分位 + 两侧须为正常壳面（排除血管/血环间隙的伪亮线）
  crackP99: 0.12,
  crackSideMargin: 0.12, // SIDE > B - margin
  crackMinLen: 0.0015,
};

function margin(x: number, th: number, scale: number): number {
  const m = Math.abs(x - th) / scale;
  return Math.min(1, 0.5 + m * 0.5);
}

export function classifyEgg(feat: ArrayLike<number>, off: number, _day = 7): EggVerdict {
  const mean = feat[off + F.MEAN];
  const base = feat[off + F.BASE];
  const ring = feat[off + F.RING];
  const ann = feat[off + F.ANN_DARK];
  const dot = feat[off + F.DOT];
  const vessel = feat[off + F.VESSEL];
  const crackP99 = feat[off + F.CRACK_P99];
  const crackSide = feat[off + F.CRACK_SIDE];
  const crackLen = feat[off + F.CRACK_LEN];

  const crack =
    crackP99 > TH.crackP99 && crackSide > base - TH.crackSideMargin && crackLen > TH.crackMinLen;

  let label: EggClass;
  let confidence: number;

  if (mean < TH.meanLate) {
    label = 'lateDead';
    confidence = margin(mean, TH.meanLate, 0.08);
  } else if (ring > TH.ringEarly && ann > TH.annEarly) {
    label = 'earlyDead';
    confidence = margin(ring, TH.ringEarly, 0.05);
  } else if (dot > TH.dotFertile) {
    label = 'fertile';
    confidence = Math.min(margin(dot, TH.dotFertile, 0.05), 0.6 + vessel * 4);
  } else {
    label = 'clear';
    confidence = margin(dot, TH.dotFertile, 0.05);
  }
  return { label, crack, confidence: Math.round(Math.min(1, confidence) * 100) / 100 };
}

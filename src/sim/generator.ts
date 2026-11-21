/**
 * 照蛋图合成器：按胚龄特征合成整盘照蛋图（纯像素运算，Node/浏览器通用）。
 *
 * 光学模型：蛋放在照蛋灯上透射成像 —— 蛋体中心亮、边缘暗；
 *   受精蛋（7 胚龄）：胚胎黑点 + 放射状血管网（"蜘蛛"征）；
 *   无精蛋：透亮均匀，偶见淡卵黄影；
 *   早死胚：血环（血管退化塌陷成环）+ 少量血点；
 *   晚死胚：大片边界模糊的暗影，无血管；
 *   发丝裂纹：壳上细亮线（透光增强），折线状。
 */
import { Rng, clamp, smoothstep } from '../util';
import { EggClass, SimTruth } from '../types';

export interface SimParams {
  rows: number;
  cols: number;
  day: number;          // 胚龄（影响血管密度/胚胎大小）
  seed: number;
  fertility: number;    // 该盘受精率基准
  earlyDeadRate: number;
  lateDeadRate: number;
  crackRate: number;
}

export interface SimTray {
  width: number;
  height: number;
  /** 灰度亮度 0~1（分析管线输入） */
  lum: Float32Array;
  /** 暖色 RGB（界面显示用） */
  rgba: Uint8ClampedArray;
  truth: SimTruth[];
  cell: number;
  margin: number;
}

export const CELL = 96;
export const MARGIN = 24;

/** 在灰度图上盖一个高斯暗斑（amp>0 变暗），下限截断防止负值 */
function gaussBlob(lum: Float32Array, w: number, h: number, cx: number, cy: number, sigma: number, amp: number) {
  const r = Math.ceil(sigma * 3);
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  const inv = 1 / (2 * sigma * sigma);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      const i = y * w + x;
      lum[i] = Math.max(lum[i] - amp * Math.exp(-(dx * dx + dy * dy) * inv), 0.1);
    }
  }
}

/** 沿线条盖章（血管/血环/裂纹）：以 strength 向目标亮度 lineLevel 收敛，重叠处不累积 */
function stampLine(
  lum: Float32Array, w: number, h: number,
  pts: { x: number; y: number; wdt: number }[],
  lineLevel: number,
  strength: number,
) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const wdt = a.wdt + (b.wdt - a.wdt) * t;
      const r = Math.max(0.6, wdt / 2);
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > r) continue;
          const px = Math.round(x + dx), py = Math.round(y + dy);
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const fall = 1 - d / (r + 0.001);
          const alpha = Math.min(1, fall * strength);
          const idx = py * w + px;
          lum[idx] = lum[idx] * (1 - alpha) + lineLevel * alpha;
        }
      }
    }
  }
}

/** 血管网：从胚胎点随机游走出分支，逐渐变细 */
function drawVessels(lum: Float32Array, w: number, h: number, rng: Rng, cx: number, cy: number, maxR: number, density: number) {
  const branches = Math.round(rng.float(5, 8) * density);
  for (let b = 0; b < branches; b++) {
    let ang = rng.float(0, Math.PI * 2);
    let x = cx, y = cy;
    const target = maxR * rng.float(0.55, 1.0);
    const pts: { x: number; y: number; wdt: number }[] = [{ x, y, wdt: rng.float(1.8, 2.6) }];
    let traveled = 0;
    const step = 3;
    while (traveled < target) {
      ang += rng.gauss(0, 0.38);
      x += Math.cos(ang) * step;
      y += Math.sin(ang) * step;
      traveled += step;
      const t = traveled / target;
      pts.push({ x, y, wdt: 2.4 * (1 - t) + 0.7 });
      // 中途分叉
      if (rng.chance(0.10) && pts.length > 3) {
        drawVessels(lum, w, h, rng, x, y, maxR * 0.45, density * 0.8);
      }
    }
    stampLine(lum, w, h, pts, rng.float(0.26, 0.36), 0.85);
  }
}

/** 血环：部分或完整的暗环 */
function drawBloodRing(lum: Float32Array, w: number, h: number, rng: Rng, cx: number, cy: number, ringR: number) {
  const start = rng.float(0, Math.PI * 2);
  const sweep = rng.float(Math.PI * 1.3, Math.PI * 2);
  const pts: { x: number; y: number; wdt: number }[] = [];
  const n = Math.ceil(ringR * sweep / 2);
  for (let i = 0; i <= n; i++) {
    const a = start + (sweep * i) / n;
    const rr = ringR + rng.gauss(0, 0.8);
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, wdt: rng.float(2.2, 3.2) });
  }
  stampLine(lum, w, h, pts, rng.float(0.20, 0.30), 0.95);
}

/** 发丝裂纹：折线亮纹 */
function drawCrack(lum: Float32Array, w: number, h: number, rng: Rng, cx: number, cy: number, R: number) {
  const a0 = rng.float(0, Math.PI * 2);
  const r0 = rng.float(0.1, 0.45) * R;
  let x = cx + Math.cos(a0) * r0;
  let y = cy + Math.sin(a0) * r0;
  let ang = rng.float(0, Math.PI * 2);
  const pts: { x: number; y: number; wdt: number }[] = [{ x, y, wdt: 1.1 }];
  const segs = rng.int(3, 6);
  for (let i = 0; i < segs; i++) {
    ang += rng.gauss(0, 0.6);
    const len = rng.float(8, 20);
    x += Math.cos(ang) * len;
    y += Math.sin(ang) * len;
    // 限制在蛋体可视区内（分析只搜索 r<0.80R，留边避开壳沿伪响应）
    const dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > 0.76 * R) {
      x = cx + (dx / d) * 0.76 * R;
      y = cy + (dy / d) * 0.76 * R;
    }
    pts.push({ x, y, wdt: 1.1 });
  }
  stampLine(lum, w, h, pts, 1.0, rng.float(0.45, 0.60));
}

export function simulateTray(p: SimParams): SimTray {
  const rng = new Rng(p.seed);
  const cell = CELL, margin = MARGIN;
  const w = p.cols * cell + margin * 2;
  const h = p.rows * cell + margin * 2;
  const lum = new Float32Array(w * h);

  // 暗室背景 + 渐晕
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / w - 0.5, ny = y / h - 0.5;
      lum[y * w + x] = 0.075 - 0.03 * (nx * nx + ny * ny);
    }
  }
  // 蛋盘格栅（盘壁更暗）
  for (let c = 0; c <= p.cols; c++) {
    const gx = margin + c * cell;
    for (let y = 0; y < h; y++) for (let dx = -1; dx <= 1; dx++) {
      const x = gx + dx;
      if (x >= 0 && x < w) lum[y * w + x] = 0.045;
    }
  }
  for (let r = 0; r <= p.rows; r++) {
    const gy = margin + r * cell;
    for (let x = 0; x < w; x++) for (let dy = -1; dy <= 1; dy++) {
      const y = gy + dy;
      if (y >= 0 && y < h) lum[x + y * w] = 0.045;
    }
  }

  const truth: SimTruth[] = [];
  const dayF = clamp((p.day - 4) / 6, 0.25, 1.4); // 胚龄因子：血管/胚胎随胚龄增长

  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const cx = margin + c * cell + cell / 2 + rng.gauss(0, 1.5);
      const cy = margin + r * cell + cell / 2 + rng.gauss(0, 1.5);
      const rx = cell * 0.375, ry = cell * 0.44;
      const R = Math.min(rx, ry);

      // 决定类别（绝对概率：早死/晚死/无精/受精）
      const abs = rng.float();
      let label: EggClass;
      if (abs < p.earlyDeadRate) label = 'earlyDead';
      else if (abs < p.earlyDeadRate + p.lateDeadRate) label = 'lateDead';
      else if (abs < p.earlyDeadRate + p.lateDeadRate + (1 - p.fertility)) label = 'clear';
      else label = 'fertile';

      const crack = rng.chance(p.crackRate);

      // 蛋体透射光基底：中心亮边缘暗
      const bright = 0.82 * rng.float(0.9, 1.1);
      const x0 = Math.max(0, Math.floor(cx - rx - 3)), x1 = Math.min(w - 1, Math.ceil(cx + rx + 3));
      const y0 = Math.max(0, Math.floor(cy - ry - 3)), y1 = Math.min(h - 1, Math.ceil(cy + ry + 3));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const ex = (x - cx) / rx, ey = (y - cy) / ry;
          const rr = Math.sqrt(ex * ex + ey * ey);
          if (rr > 1.04) continue;
          const edge = smoothstep(1.04, 0.93, rr);
          const v = bright * (1 - 0.52 * rr * rr) * edge;
          lum[y * w + x] = Math.max(lum[y * w + x], v);
        }
      }

      if (label === 'clear') {
        // 淡卵黄影（低对比）
        if (rng.chance(0.5)) {
          gaussBlob(lum, w, h, cx + rng.gauss(0, 6), cy + rng.gauss(0, 6), rng.float(12, 17), rng.float(0.03, 0.07));
        }
      } else if (label === 'fertile') {
        // 胚胎点
        const ex = cx + rng.gauss(0, R * 0.18), ey = cy + rng.gauss(0, R * 0.18);
        gaussBlob(lum, w, h, ex, ey, rng.float(4, 6.5) * Math.sqrt(dayF), rng.float(0.26, 0.38));
        // 血管网
        drawVessels(lum, w, h, rng, ex, ey, R * rng.float(0.5, 0.68) * (0.6 + 0.4 * dayF), rng.float(0.85, 1.2) * dayF);
      } else if (label === 'earlyDead') {
        drawBloodRing(lum, w, h, rng, cx + rng.gauss(0, 3), cy + rng.gauss(0, 3), R * rng.float(0.48, 0.64));
        if (rng.chance(0.4)) gaussBlob(lum, w, h, cx + rng.gauss(0, 8), cy + rng.gauss(0, 8), rng.float(2.5, 4), rng.float(0.15, 0.25));
      } else {
        // 晚死胚：大片模糊暗影，整蛋透光变差
        const nBlobs = rng.int(2, 3);
        for (let i = 0; i < nBlobs; i++) {
          gaussBlob(lum, w, h, cx + rng.gauss(0, R * 0.25), cy + rng.gauss(0, R * 0.25), rng.float(12, 20), rng.float(0.20, 0.32));
        }
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const ex = (x - cx) / rx, ey = (y - cy) / ry;
            if (Math.sqrt(ex * ex + ey * ey) < 1.0) lum[y * w + x] *= 0.85;
          }
        }
      }

      if (crack) drawCrack(lum, w, h, rng, cx, cy, R);
      truth.push({ label, crack });
    }
  }

  // 整盘照度不均 + 传感器噪声
  const gx = rng.float(-0.09, 0.09), gy = rng.float(-0.07, 0.07);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      lum[i] = lum[i] * (1 + gx * (x / w - 0.5) * 2 + gy * (y / h - 0.5) * 2) + rng.gauss(0, 0.012);
    }
  }

  // 转暖色 RGB
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = clamp(lum[i], 0, 1);
    const g = Math.pow(v, 0.9);
    rgba[i * 4] = clamp(g * 255 * 1.0, 0, 255);
    rgba[i * 4 + 1] = clamp(g * 255 * 0.80, 0, 255);
    rgba[i * 4 + 2] = clamp(g * 255 * 0.58, 0, 255);
    rgba[i * 4 + 3] = 255;
  }

  return { width: w, height: h, lum, rgba, truth, cell, margin };
}

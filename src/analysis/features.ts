/**
 * 特征提取（CPU 参考实现，与 WebGL2 管线同构）。
 *
 * 设计：不做全局归一化，改为"每蛋基线"——
 *   以蛋壳亮区环带(0.70~0.88R)均值为该蛋基线 B，所有暗类特征相对 B 度量，
 *   裂纹/血管等线特征用局部邻域对比（与照度场无关）。
 *   另保留绝对亮度特征（MEAN/ABS_DARK）捕捉整体变暗的晚死胚。
 */
import { F, FEATURE_COUNT, Grid } from '../types';

/** 自动定位蛋盘网格：亮蛋行列投影 → 初始中心 → 逐列/逐行亮度质心精化（抗累积漂移） */
export function detectGrid(lum: Float32Array, w: number, h: number, rows: number, cols: number): Grid {
  const colSum = new Float64Array(w);
  const rowSum = new Float64Array(h);
  let maxV = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const v = lum[y * w + x];
      colSum[x] += v;
      rowSum[y] += v;
      if (v > maxV) maxV = v;
    }
  }
  const th = maxV * 0.25;
  const colTh = th * (h / 2) * 0.35;
  const rowTh = th * (w / 2) * 0.35;
  let x0 = 0, x1 = w - 1, y0 = 0, y1 = h - 1;
  while (x0 < w - 1 && colSum[x0] < colTh) x0++;
  while (x1 > x0 && colSum[x1] < colTh) x1--;
  while (y0 < h - 1 && rowSum[y0] < rowTh) y0++;
  while (y1 > y0 && rowSum[y1] < rowTh) y1--;
  const cellW = (x1 - x0 + 1) / cols;
  const cellH = (y1 - y0 + 1) / rows;
  const gx0 = x0 - cellW * 0.14;
  const gy0 = y0 - cellH * 0.06;
  const cw = (x1 - x0 + 1 + cellW * 0.28) / cols;
  const ch = (y1 - y0 + 1 + cellH * 0.12) / rows;

  // 初始中心 → 质心精化
  const cx = new Float32Array(cols);
  const cy = new Float32Array(rows);
  for (let j = 0; j < cols; j++) cx[j] = gx0 + (j + 0.5) * cw;
  for (let i = 0; i < rows; i++) cy[i] = gy0 + (i + 0.5) * ch;
  const brightTh = maxV * 0.4;
  for (let j = 0; j < cols; j++) {
    const xa = Math.max(0, Math.round(cx[j] - cw * 0.45));
    const xb = Math.min(w - 1, Math.round(cx[j] + cw * 0.45));
    let s = 0, sw = 0;
    for (let x = xa; x <= xb; x++) {
      let colV = 0;
      for (let y = 0; y < h; y += 3) colV += lum[y * w + x];
      const wgt = Math.max(0, colV - brightTh * (h / 3) * 0.6);
      s += x * wgt; sw += wgt;
    }
    if (sw > 0) cx[j] = s / sw;
  }
  for (let i = 0; i < rows; i++) {
    const ya = Math.max(0, Math.round(cy[i] - ch * 0.45));
    const yb = Math.min(h - 1, Math.round(cy[i] + ch * 0.45));
    let s = 0, sw = 0;
    for (let y = ya; y <= yb; y++) {
      let rowV = 0;
      for (let x = 0; x < w; x += 3) rowV += lum[y * w + x];
      const wgt = Math.max(0, rowV - brightTh * (w / 3) * 0.6);
      s += y * wgt; sw += wgt;
    }
    if (sw > 0) cy[i] = s / sw;
  }
  return { rows, cols, cellW: cw, cellH: ch, cx, cy };
}

const CRACK_DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
];

/**
 * 提取整盘特征，返回 rows*cols*16 的 Float32Array。
 * 与 GPU 版（src/gpu/pipeline.ts）保持同一套数学定义。
 */
export function extractFeaturesCpu(lum: Float32Array, w: number, h: number, grid: Grid): Float32Array {
  // 积分图（胚胎点响应的盒均值查询）
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowsum = 0;
    for (let x = 0; x < w; x++) {
      rowsum += lum[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + rowsum;
    }
  }
  const clampi = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  const boxMean = (ccx: number, ccy: number, r: number): number => {
    const xa = clampi(Math.floor(ccx - r), w - 1), xb = clampi(Math.ceil(ccx + r), w - 1);
    const ya = clampi(Math.floor(ccy - r), h - 1), yb = clampi(Math.ceil(ccy + r), h - 1);
    const s =
      integral[(yb + 1) * (w + 1) + xb + 1] - integral[ya * (w + 1) + xb + 1] -
      integral[(yb + 1) * (w + 1) + xa] + integral[ya * (w + 1) + xa];
    return s / ((xb - xa + 1) * (yb - ya + 1));
  };

  const n = grid.rows * grid.cols;
  const out = new Float32Array(n * FEATURE_COUNT);

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const idx = row * grid.cols + col;
      const o = idx * FEATURE_COUNT;
      const cx = grid.cx[col];
      const cy = grid.cy[row];
      const rx = grid.cellW * 0.375, ry = grid.cellH * 0.44;
      const R = Math.min(rx, ry);

      const x0 = Math.max(1, Math.floor(cx - rx)), x1 = Math.min(w - 2, Math.ceil(cx + rx));
      const y0 = Math.max(1, Math.floor(cy - ry)), y1 = Math.min(h - 2, Math.ceil(cy + ry));

      // 第一遍：基线环带均值 B + 径向亮度剖面（8 档，作为"该半径处壳面应有亮度"）
      let baseSum = 0, baseCnt = 0;
      const profSum = new Float64Array(8);
      const profCnt = new Float64Array(8);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const ex = (x - cx) / rx, ey = (y - cy) / ry;
          const rr = Math.sqrt(ex * ex + ey * ey);
          if (rr >= 0.70 && rr <= 0.88) { baseSum += lum[y * w + x]; baseCnt++; }
          if (rr < 0.92) {
            const bin = Math.min(7, Math.floor(rr / 0.92 * 8));
            profSum[bin] += lum[y * w + x]; profCnt[bin]++;
          }
        }
      }
      const B = baseCnt ? baseSum / baseCnt : 0.6;
      const prof = new Float64Array(8);
      for (let b = 0; b < 8; b++) prof[b] = profCnt[b] ? profSum[b] / profCnt[b] : B;
      const darkTh = B - 0.10;
      const vdarkTh = Math.min(B - 0.20, 0.40);

      let cnt = 0, sum = 0;
      let dark = 0, vdark = 0, absDark = 0, innerDark = 0, innerCnt = 0, annDark = 0, annCnt = 0;
      let vessel = 0, vesselCnt = 0;
      let darkCx = 0, darkCy = 0, darkCntW = 0;
      const crackResps: number[] = [];
      let crackMax = 0;
      let sideSum = 0, sideCnt = 0;

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const ex = (x - cx) / rx, ey = (y - cy) / ry;
          const rr = Math.sqrt(ex * ex + ey * ey);
          if (rr > 0.92) continue;
          const c = lum[y * w + x];
          cnt++; sum += c;
          const isDark = c < darkTh;
          if (isDark) {
            dark++;
            darkCx += x; darkCy += y; darkCntW++;
          }
          if (c < vdarkTh) vdark++;
          if (c < 0.32) absDark++;
          if (rr < 0.38) { innerCnt++; if (isDark) innerDark++; }
          if (rr >= 0.45 && rr <= 0.70) { annCnt++; if (isDark) annDark++; }
          // 细暗线（血管）：仅内核区，避开血环所在环带
          if (rr < 0.40) {
            vesselCnt++;
            const l = lum[y * w + x - 1], r2 = lum[y * w + x + 1];
            const u = lum[(y - 1) * w + x], d = lum[(y + 1) * w + x];
            const n4 = (l + r2 + u + d) * 0.25;
            if (n4 - c > 0.045 && c < B - 0.03) vessel++;
          }
          // 裂纹：4 方向亮线滤波，限 r<0.80 避开壳沿。
          // 响应 = 中心线 - max(两侧, 该半径壳面剖面)：
          //   裂纹中心"亮过壳面本身"；血管间隙只是"两侧暗"，中心并不超亮 → 抑制。
          if (rr < 0.80) {
            const profHere = prof[Math.min(7, Math.floor(rr / 0.92 * 8))];
            let best = 0;
            for (const [dx, dy] of CRACK_DIRS) {
              const px = -dy, py = dx;
              const center =
                (lum[Math.round(y - dy) * w + Math.round(x - dx)] + c + lum[Math.round(y + dy) * w + Math.round(x + dx)]) / 3;
              let sideA = 0, sideB = 0;
              for (const soff of [-3, -2]) {
                const sx = Math.round(x + px * soff), sy = Math.round(y + py * soff);
                sideA += lum[sy * w + sx];
              }
              for (const soff of [2, 3]) {
                const sx = Math.round(x + px * soff), sy = Math.round(y + py * soff);
                sideB += lum[sy * w + sx];
              }
              const sideMax = Math.max(sideA, sideB) / 2;
              const resp = center - Math.max(sideMax, profHere);
              if (resp > best) best = resp;
              // 高响应像素的两侧亮度（辅助判据）
              if (resp > 0.05) { sideSum += sideMax; sideCnt++; }
            }
            crackResps.push(best);
            if (best > crackMax) crackMax = best;
          }
        }
      }

      // 胚胎点响应：内核区 8px 环绕均值 - 3px 中心均值 的最大值（隔点采样）
      let dot = 0;
      for (let y = Math.floor(cy - R * 0.5); y <= cy + R * 0.5; y += 2) {
        for (let x = Math.floor(cx - R * 0.5); x <= cx + R * 0.5; x += 2) {
          const resp = boxMean(x, y, 8) - boxMean(x, y, 3);
          if (resp > dot) dot = resp;
        }
      }

      crackResps.sort((a, b) => a - b);
      const p99 = crackResps.length ? crackResps[Math.floor(crackResps.length * 0.995)] : 0;
      let crackLen = 0;
      if (crackMax > 1e-6) {
        for (const v of crackResps) if (v > Math.max(0.04, crackMax * 0.5)) crackLen++;
        crackLen /= Math.max(1, crackResps.length);
      }

      const mean = sum / Math.max(1, cnt);
      const darkFrac = dark / Math.max(1, cnt);
      const dcx = darkCntW > 0 ? darkCx / darkCntW : cx;
      const dcy = darkCntW > 0 ? darkCy / darkCntW : cy;
      let spread = 0;
      if (darkCntW > 0) {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const ex = (x - cx) / rx, ey = (y - cy) / ry;
            if (Math.sqrt(ex * ex + ey * ey) > 0.92) continue;
            if (lum[y * w + x] < darkTh) {
              spread += (x - dcx) * (x - dcx) + (y - dcy) * (y - dcy);
            }
          }
        }
        spread /= darkCntW;
      }

      out[o + F.MEAN] = mean;
      out[o + F.BASE] = B;
      out[o + F.DARK] = darkFrac;
      out[o + F.VDARK] = vdark / Math.max(1, cnt);
      out[o + F.INNER_DARK] = innerDark / Math.max(1, innerCnt);
      out[o + F.ANN_DARK] = annDark / Math.max(1, annCnt);
      out[o + F.RING] = out[o + F.ANN_DARK] - out[o + F.INNER_DARK];
      out[o + F.VESSEL] = vessel / Math.max(1, vesselCnt);
      out[o + F.DOT] = dot;
      out[o + F.CRACK_MAX] = crackMax;
      out[o + F.CRACK_P99] = p99;
      out[o + F.CRACK_LEN] = crackLen;
      out[o + F.CENTR] = Math.hypot(dcx - cx, dcy - cy) / R;
      out[o + F.SPREAD] = spread / (R * R);
      out[o + F.CRACK_SIDE] = sideCnt ? sideSum / sideCnt : 0;
      out[o + F.ABS_DARK] = absDark / Math.max(1, cnt);
    }
  }
  return out;
}

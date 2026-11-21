/** 调试：定位早死胚蛋中裂纹滤波响应最强的像素，打印局部亮度补丁 */
import { simulateTray, CELL, MARGIN } from '../src/sim/generator';

const sim = simulateTray({
  rows: 2, cols: 2, day: 7, seed: 42,
  fertility: 0.0, earlyDeadRate: 1.0, lateDeadRate: 0.0, crackRate: 0.0,
});
const { lum, width: w, truth } = sim;
console.log('truth:', truth.map((t) => t.label));

const DIRS: [number, number][] = [[1, 0], [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]];

// 第一枚蛋
const cx = MARGIN + CELL / 2, cy = MARGIN + CELL / 2;
const rx = CELL * 0.375, ry = CELL * 0.44;
let best = -1, bx = 0, by = 0;
for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
  for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const ex = (x - cx) / rx, ey = (y - cy) / ry;
    if (Math.sqrt(ex * ex + ey * ey) > 0.8) continue;
    let b = 0;
    for (const [dx, dy] of DIRS) {
      const px = -dy, py = dx;
      const c = lum[y * w + x];
      const center = (lum[Math.round(y - dy) * w + Math.round(x - dx)] + c + lum[Math.round(y + dy) * w + Math.round(x + dx)]) / 3;
      let sA = 0, sB = 0;
      for (const s of [-3, -2]) sA += lum[Math.round(y + py * s) * w + Math.round(x + px * s)];
      for (const s of [2, 3]) sB += lum[Math.round(y + py * s) * w + Math.round(x + px * s)];
      const resp = center - Math.max(sA, sB) / 2;
      if (resp > b) b = resp;
    }
    if (b > best) { best = b; bx = x; by = y; }
  }
}
console.log(`max resp=${best.toFixed(3)} at (${bx},${by}), rel=(${(bx - cx).toFixed(0)},${(by - cy).toFixed(0)})`);
for (let dy = -5; dy <= 5; dy++) {
  let line = '';
  for (let dx = -5; dx <= 5; dx++) {
    line += lum[(by + dy) * w + bx + dx].toFixed(2).padStart(6);
  }
  console.log(line);
}

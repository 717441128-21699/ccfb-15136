/** 照蛋结果页：整盘图 + 网格叠加 + 单蛋判别 + 盘统计 + 系统自检 */
import { h, fmtPct } from './components';
import { batchOf, houseOf, loadDb, resultOf, save, traysOf } from '../store';
import { analyzeTray, getTrayImage, gridOf, importImage, TrayImage } from '../analysis/runner';
import { simulateTray } from '../sim/generator';
import { detectGrid } from '../analysis/features';
import { extractFeatures } from '../gpu/pipeline';
import { classifyEgg } from '../analysis/classify';
import { CLASS_COLORS, CLASS_NAMES, CLASSES, FEATURE_COUNT, F, Tray, TrayResult } from '../types';

let curBatchId: string | null = null;
let curTrayId: string | null = null;
let selectedEgg = -1;

export function candlingPage(batchId?: string): HTMLElement {
  const db = loadDb();
  if (batchId) curBatchId = batchId;
  if (!curBatchId || !db.batches.find((b) => b.id === curBatchId)) curBatchId = db.batches[0]?.id ?? null;

  const root = h('div', {});
  if (!curBatchId) {
    root.append(h('p', { className: 'muted' }, '请先在"入孵批次"页新建批次。'));
    return root;
  }
  const batch = db.batches.find((b) => b.id === curBatchId)!;
  const trays = traysOf(batch.id);
  if (!curTrayId || !trays.find((t) => t.id === curTrayId)) curTrayId = trays[0]?.id ?? null;
  const tray = trays.find((t) => t.id === curTrayId)!;

  // 头部：批次/盘选择 + 操作
  const batchSel = h('select', {
    onchange: (e: Event) => {
      curBatchId = (e.target as HTMLSelectElement).value;
      curTrayId = null;
      selectedEgg = -1;
      rerender();
    },
  }, ...db.batches.map((b) => h('option', { value: b.id, ...(b.id === curBatchId ? { selected: true } : {}) }, `${b.code}（${houseOf(b)?.name ?? '?'}）`)));

  const trayChips = h('div', { className: 'chips' },
    ...trays.map((t) => {
      const done = !!resultOf(t.id);
      return h('button', {
        className: `chip ${t.id === curTrayId ? 'active' : ''} ${done ? 'done' : ''}`,
        onclick: () => { curTrayId = t.id; selectedEgg = -1; rerender(); },
      }, `${t.index}号盘${done ? '✓' : ''}`);
    }),
  );

  const canvas = h('canvas', { className: 'tray-canvas' }) as HTMLCanvasElement;
  const detailBox = h('div', { className: 'card detail' });
  const statsBox = h('div', { className: 'stats-row' });
  const selftestBox = h('div', {});

  function currentResult(): TrayResult | undefined {
    return resultOf(tray.id);
  }

  function draw() {
    let img: TrayImage;
    try {
      img = getTrayImage(tray);
    } catch (e) {
      canvas.width = 800;
      canvas.height = 120;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#9b8d7d';
      ctx.font = '14px sans-serif';
      ctx.fillText(`无法显示图像：${e instanceof Error ? e.message : e}（导入的图片不持久化，请重新导入）`, 16, 60);
      return;
    }
    const off = document.createElement('canvas');
    off.width = img.width;
    off.height = img.height;
    off.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
    const maxW = Math.min(1040, canvas.parentElement?.clientWidth || 1040);
    const scale = maxW / img.width;
    canvas.width = maxW;
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

    const grid = gridOf(img, tray);
    const res = currentResult();
    ctx.lineWidth = 1.2;
    for (let r = 0; r < tray.rows; r++) {
      for (let c = 0; c < tray.cols; c++) {
        const i = r * tray.cols + c;
        const cx = grid.cx[c] * scale;
        const cy = grid.cy[r] * scale;
        const rx = grid.cellW * 0.375 * scale;
        const ry = grid.cellH * 0.44 * scale;
        const egg = res?.eggs[i];
        ctx.strokeStyle = egg ? CLASS_COLORS[egg.label] : 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (egg?.crack) {
          ctx.strokeStyle = '#e14bdc';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx * 0.7, ry * 0.7, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 1.2;
        }
        if (i === selectedEgg) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx + 3, ry + 3, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 1.2;
        }
      }
    }
    canvas.onclick = (ev) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (ev.clientX - rect.left) / scale;
      const my = (ev.clientY - rect.top) / scale;
      let best = -1, bestD = 1e9;
      for (let r = 0; r < tray.rows; r++) {
        for (let c = 0; c < tray.cols; c++) {
          const d = Math.hypot(grid.cx[c] - mx, grid.cy[r] - my);
          if (d < bestD) { bestD = d; best = r * tray.cols + c; }
        }
      }
      selectedEgg = best;
      draw();
      drawDetail();
    };
  }

  function drawDetail() {
    detailBox.replaceChildren();
    if (selectedEgg < 0) {
      detailBox.append(h('p', { className: 'muted' }, '点击盘中任意一枚蛋查看判别详情。'));
      return;
    }
    const img = getTrayImage(tray);
    const grid = gridOf(img, tray);
    const res = currentResult();
    const r = Math.floor(selectedEgg / tray.cols);
    const c = selectedEgg % tray.cols;
    const cx = grid.cx[c], cy = grid.cy[r];
    const half = grid.cellW / 2;
    const crop = h('canvas', { width: 160, height: 160, className: 'crop' }) as HTMLCanvasElement;
    const off = document.createElement('canvas');
    off.width = img.width;
    off.height = img.height;
    off.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
    crop.getContext('2d')!.drawImage(off, cx - half, cy - half, half * 2, half * 2, 0, 0, 160, 160);

    const egg = res?.eggs[selectedEgg];
    const featLines: string[] = [];
    if (egg) {
      detailBox.append(
        h('div', { className: 'detail-head' },
          crop,
          h('div', {},
            h('h3', {}, `${r + 1} 行 ${c + 1} 列`),
            h('p', {},
              h('span', { className: 'tag', style: `background:${CLASS_COLORS[egg.label]}` }, CLASS_NAMES[egg.label]),
              egg.crack ? h('span', { className: 'tag', style: 'background:#e14bdc' }, '发丝裂纹') : null,
            ),
            h('p', { className: 'muted' }, `置信度 ${(egg.confidence * 100).toFixed(0)}%`),
            h('a', { href: '#/review', className: 'btn-link' }, '前往复核 →'),
          ),
        ),
      );
    } else {
      detailBox.append(h('div', { className: 'detail-head' }, crop, h('p', { className: 'muted' }, '尚未分析，请先运行分析。')));
    }
    void featLines;
  }

  function drawStats() {
    statsBox.replaceChildren();
    const res = currentResult();
    if (!res) {
      statsBox.append(h('p', { className: 'muted' }, '本盘尚未分析。'));
      return;
    }
    const s = res.stats;
    const card = (label: string, val: string, color?: string) =>
      h('div', { className: 'stat-card', ...(color ? { style: `border-color:${color}` } : {}) },
        h('div', { className: 'stat-val' }, val), h('div', { className: 'stat-label' }, label));
    statsBox.append(
      card('受精率', fmtPct(s.fertileRate), CLASS_COLORS.fertile),
      card('受精', String(s.fertile), CLASS_COLORS.fertile),
      card('无精', String(s.clear), CLASS_COLORS.clear),
      card('早死胚', String(s.earlyDead), CLASS_COLORS.earlyDead),
      card('晚死胚', String(s.lateDead), CLASS_COLORS.lateDead),
      card('发丝裂纹', String(s.cracks), '#e14bdc'),
      card('分析耗时', `${res.durationMs} ms`),
      card('引擎', res.engine === 'webgl2' ? 'WebGL2' : 'CPU'),
    );
  }

  const fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none' }) as HTMLInputElement;
  fileInput.onchange = async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    tray.imported = true;
    save();
    await importImage(tray, f);
    rerender();
  };

  const ops = h('div', { className: 'form-row' },
    h('button', {
      className: 'primary',
      onclick: () => {
        const res = analyzeTray(tray);
        draw(); drawStats(); drawDetail();
        selftestBox.replaceChildren();
        void res;
      },
    }, '▶ 运行分析'),
    h('button', { onclick: () => fileInput.click() }, '导入照蛋图…'),
    h('button', {
      onclick: () => {
        const res = currentResult();
        if (!res) return;
        const rows = [['盘', '行', '列', '判别', '裂纹', '置信度'].join(',')];
        res.eggs.forEach((e, i) => {
          rows.push([tray.index, Math.floor(i / tray.cols) + 1, (i % tray.cols) + 1, CLASS_NAMES[e.label], e.crack ? '是' : '否', e.confidence].join(','));
        });
        const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv' });
        const a = h('a', { href: URL.createObjectURL(blob), download: `${batch.code}_盘${tray.index}_照蛋结果.csv` });
        a.click();
      },
    }, '导出 CSV'),
    h('button', { onclick: runSelftest }, '系统自检'),
    fileInput,
  );

  async function runSelftest() {
    selftestBox.replaceChildren(h('p', { className: 'muted' }, '自检中：合成 12 盘带真值照蛋图（5~9 胚龄）…'));
    await new Promise((r) => setTimeout(r, 30));
    let total = 0, agree = 0, crackTruth = 0, crackHit = 0, crackFp = 0, ms = 0;
    const TRAYS = 12;
    for (let t = 0; t < TRAYS; t++) {
      const day = 5 + (t % 5);
      const sim = simulateTray({
        rows: 10, cols: 15, day, seed: 5000 + t * 131,
        fertility: [0.95, 0.93, 0.84, 0.91][t % 4],
        earlyDeadRate: 0.025, lateDeadRate: 0.015, crackRate: 0.05,
      });
      const t0 = performance.now();
      const grid = detectGrid(sim.lum, sim.width, sim.height, 10, 15);
      const { features } = extractFeatures(sim.lum, sim.width, sim.height, grid);
      ms += performance.now() - t0;
      for (let i = 0; i < sim.truth.length; i++) {
        const v = classifyEgg(features, i * FEATURE_COUNT, day);
        total++;
        if (v.label === sim.truth[i].label) agree++;
        if (sim.truth[i].crack) { crackTruth++; if (v.crack) crackHit++; }
        else if (v.crack) crackFp++;
      }
    }
    const line = (label: string, val: string, ok: boolean) =>
      h('div', { className: 'stat-card', style: `border-color:${ok ? '#3fb950' : '#d64545'}` },
        h('div', { className: 'stat-val' }, val), h('div', { className: 'stat-label' }, label));
    selftestBox.replaceChildren(
      h('div', { className: 'card' },
        h('h3', {}, '系统自检（对合成真值）'),
        h('div', { className: 'stats-row' },
          line('四类判别一致率（≥95%）', fmtPct(agree / total, 2), agree / total >= 0.95),
          line('裂纹检出率（≥90%）', fmtPct(crackHit / crackTruth, 2), crackHit / crackTruth >= 0.9),
          line('裂纹误报率', fmtPct(crackFp / (total - crackTruth), 2), true),
          line('单盘平均耗时（<1.5s）', `${Math.round(ms / TRAYS)} ms`, ms / TRAYS < 1500),
        ),
        h('p', { className: 'muted' }, `样本 ${total} 枚 / ${TRAYS} 盘。命令行复核：npm run validate`),
      ),
    );
  }

  function rerender() {
    root.replaceChildren();
    root.append(buildMain());
    draw();
    drawStats();
    drawDetail();
  }

  function buildMain(): HTMLElement {
    const b = db.batches.find((x) => x.id === curBatchId)!;
    return h('div', {},
      h('h2', {}, '照蛋结果'),
      h('div', { className: 'card form-row' },
        h('label', {}, '批次 ', batchSel),
        h('span', { className: 'muted' }, `入孵 ${b.setDate} · ${b.day} 胚龄 · ${houseOf(b)?.name ?? ''}`),
      ),
      trayChips,
      ops,
      statsBox,
      h('div', { className: 'layout-2col' },
        h('div', { className: 'card' }, canvas),
        detailBox,
      ),
      h('p', { className: 'muted' }, '图例：绿=受精 黄=无精 橙=早死胚 红=晚死胚 紫圈=发丝裂纹。合成演示图按当前胚龄特征生成；也可导入实拍整盘照片（图片不持久化，结果会保存）。'),
      selftestBox,
    );
  }

  root.append(buildMain());
  // 首帧绘制
  setTimeout(() => { draw(); drawStats(); drawDetail(); }, 0);
  return root;
}

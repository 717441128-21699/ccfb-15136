/** 复核页：低置信/裂纹/抽检蛋逐枚人工复核，统计人机一致率 */
import { h, fmtPct } from './components';
import { batchOf, loadDb, resultOf, save, saveReview } from '../store';
import { getTrayImage, gridOf, trayHasTruth } from '../analysis/runner';
import { CLASS_COLORS, CLASS_NAMES, CLASSES, EggClass, ReviewRec, Tray } from '../types';

interface QueueItem {
  tray: Tray;
  eggIndex: number;
}

/** 复核队列：低置信 + 裂纹 + 10% 确定性抽检 */
function buildQueue(): QueueItem[] {
  const db = loadDb();
  const items: QueueItem[] = [];
  for (const tray of db.trays) {
    const res = resultOf(tray.id);
    if (!res) continue;
    res.eggs.forEach((e, i) => {
      const sampled = (i * 2654435761) % 100 < 10;
      if (e.confidence < 0.75 || e.crack || sampled) items.push({ tray, eggIndex: i });
    });
  }
  return items;
}

let keyHandler: ((ev: KeyboardEvent) => void) | null = null;

export function reviewPage(): HTMLElement {
  const root = h('div', {});
  let queue = buildQueue();
  let pos = 0;

  // 跳过已复核
  const doneSet = new Set(loadDb().reviews.map((r) => `${r.trayId}:${r.eggIndex}`));
  while (pos < queue.length && doneSet.has(`${queue[pos].tray.id}:${queue[pos].eggIndex}`)) pos++;

  const summaryBox = h('div', { className: 'stats-row' });
  const mainBox = h('div', {});

  function drawSummary() {
    const reviews = loadDb().reviews;
    const labeled = reviews.filter((r) => r.humanLabel);
    const agree = labeled.filter((r) => r.humanLabel === r.machine.label).length;
    const crackM = reviews.filter((r) => r.machine.crack);
    const crackHit = crackM.filter((r) => r.humanCrack === true).length;
    const card = (label: string, val: string) =>
      h('div', { className: 'stat-card' }, h('div', { className: 'stat-val' }, val), h('div', { className: 'stat-label' }, label));
    summaryBox.replaceChildren(
      card('已复核', String(labeled.length)),
      card('人机一致率', labeled.length ? fmtPct(agree / labeled.length, 2) : '-'),
      card('机器报裂纹', String(crackM.length)),
      card('裂纹人工确认率', crackM.length ? fmtPct(crackHit / crackM.length) : '-'),
    );
  }

  function drawItem() {
    mainBox.replaceChildren();
    if (pos >= queue.length) {
      mainBox.append(h('div', { className: 'card ok' }, '复核队列已完成。'));
      drawSummary();
      return;
    }
    const { tray, eggIndex } = queue[pos];
    const res = resultOf(tray.id)!;
    const egg = res.eggs[eggIndex];
    const batch = batchOf(tray);
    let img;
    try {
      img = getTrayImage(tray);
    } catch {
      // 导入图丢失（刷新后）→ 跳过该项
      pos++;
      setTimeout(drawItem, 0);
      return;
    }
    const grid = gridOf(img, tray);
    const r = Math.floor(eggIndex / tray.cols);
    const c = eggIndex % tray.cols;

    const crop = h('canvas', { width: 220, height: 220, className: 'crop large' }) as HTMLCanvasElement;
    const off = document.createElement('canvas');
    off.width = img.width;
    off.height = img.height;
    off.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
    const half = grid.cellW / 2;
    crop.getContext('2d')!.drawImage(off, grid.cx[c] - half, grid.cy[r] - half, half * 2, half * 2, 0, 0, 220, 220);

    let crackFlag = egg.crack;
    const crackBtn = h('button', { className: egg.crack ? 'toggle on' : 'toggle' }, `裂纹：${egg.crack ? '有' : '无'}`);
    crackBtn.onclick = () => {
      crackFlag = !crackFlag;
      crackBtn.className = `toggle ${crackFlag ? 'on' : ''}`;
      crackBtn.textContent = `裂纹：${crackFlag ? '有' : '无'}`;
    };

    const submit = (label: EggClass) => {
      const rec: ReviewRec = {
        trayId: tray.id,
        eggIndex,
        machine: egg,
        humanLabel: label,
        humanCrack: crackFlag,
        reviewedAt: Date.now(),
      };
      saveReview(rec);
      pos++;
      while (pos < queue.length && doneSet.has(`${queue[pos].tray.id}:${queue[pos].eggIndex}`)) pos++;
      drawItem();
    };

    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = (ev: KeyboardEvent) => {
      const idx = ['1', '2', '3', '4'].indexOf(ev.key);
      if (idx >= 0) submit(CLASSES[idx]);
      if (ev.key.toLowerCase() === 'c') crackBtn.click();
    };
    document.addEventListener('keydown', keyHandler);

    mainBox.append(
      h('div', { className: 'card' },
        h('div', { className: 'form-row', style: 'justify-content:space-between' },
          h('span', {}, `批次 ${batch?.code ?? '?'} · ${tray.index} 号盘 · ${r + 1} 行 ${c + 1} 列`),
          h('span', { className: 'muted' }, `队列 ${pos + 1}/${queue.length}`),
        ),
        h('div', { className: 'detail-head' },
          crop,
          h('div', {},
            h('p', {},
              '机器判别：',
              h('span', { className: 'tag', style: `background:${CLASS_COLORS[egg.label]}` }, CLASS_NAMES[egg.label]),
              egg.crack ? h('span', { className: 'tag', style: 'background:#e14bdc' }, '裂纹') : null,
              h('span', { className: 'muted' }, ` 置信度 ${(egg.confidence * 100).toFixed(0)}%`),
            ),
            h('p', { className: 'muted' }, '人工判定（快捷键 1-4，C 切换裂纹）：'),
            h('div', { className: 'form-row' },
              ...CLASSES.map((cls, i) =>
                h('button', { className: 'review-btn', style: `border-color:${CLASS_COLORS[cls]}`, onclick: () => submit(cls) },
                  `${i + 1} ${CLASS_NAMES[cls]}`),
              ),
            ),
            h('div', { className: 'form-row' }, crackBtn),
          ),
        ),
      ),
    );
    drawSummary();
  }

  // 演示：合成盘可按真值一键完成复核
  const demoBtn = h('button', {
    className: 'ghost',
    onclick: () => {
      for (const item of queue) {
        if (!trayHasTruth(item.tray)) continue;
        const img = getTrayImage(item.tray);
        const truth = img.truth?.[item.eggIndex];
        if (!truth) continue;
        const res = resultOf(item.tray.id)!;
        saveReview({
          trayId: item.tray.id,
          eggIndex: item.eggIndex,
          machine: res.eggs[item.eggIndex],
          humanLabel: truth.label,
          humanCrack: truth.crack,
          reviewedAt: Date.now(),
        });
      }
      queue = buildQueue();
      pos = queue.length;
      drawItem();
    },
  }, '演示：按合成真值完成全部复核');

  const clearBtn = h('button', {
    className: 'ghost',
    onclick: () => {
      const db = loadDb();
      db.reviews = [];
      save();
      queue = buildQueue();
      pos = 0;
      drawItem();
    },
  }, '清空复核记录');

  root.append(
    h('h2', {}, '人工复核'),
    h('div', { className: 'card form-row' },
      h('span', { className: 'muted' }, '队列 = 低置信度 + 机器报裂纹 + 10% 抽检。复核结果用于一致率考核，并回写种鸡舍统计。'),
      demoBtn, clearBtn,
    ),
    summaryBox,
    mainBox,
  );
  setTimeout(drawItem, 0);
  return root;
}

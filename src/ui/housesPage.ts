/** 种鸡舍统计页：按舍聚合受精率/死胚率/裂纹率，低受精率舍标红追溯 */
import { h, fmtPct } from './components';
import { effectiveEggs, loadDb, traysOf } from '../store';
import { CLASS_NAMES, CLASSES, EggClass } from '../types';

const LOW_FERTILITY = 0.9;

export function housesPage(): HTMLElement {
  const db = loadDb();

  interface Agg {
    total: number;
    byClass: Record<EggClass, number>;
    cracks: number;
    batches: number;
    trays: number;
  }
  const agg = new Map<string, Agg>();
  for (const house of db.houses) {
    agg.set(house.id, {
      total: 0, cracks: 0, batches: 0, trays: 0,
      byClass: { fertile: 0, clear: 0, earlyDead: 0, lateDead: 0 },
    });
  }
  for (const batch of db.batches) {
    const a = agg.get(batch.houseId);
    if (!a) continue;
    let counted = false;
    for (const tray of traysOf(batch.id)) {
      const eggs = effectiveEggs(tray.id);
      if (!eggs.length) continue;
      counted = true;
      a.trays++;
      for (const e of eggs) {
        a.total++;
        a.byClass[e.label]++;
        if (e.crack) a.cracks++;
      }
    }
    if (counted) a.batches++;
  }

  const rows = db.houses.map((house) => {
    const a = agg.get(house.id)!;
    const fr = a.total ? a.byClass.fertile / a.total : 0;
    const low = a.total > 0 && fr < LOW_FERTILITY;
    const bar = (cls: EggClass) => {
      const pct = a.total ? a.byClass[cls] / a.total : 0;
      return h('div', { className: 'bar-seg', style: `width:${pct * 100}%;background:var(--c-${cls})`, title: `${CLASS_NAMES[cls]} ${fmtPct(pct)}` });
    };
    return h('tr', { className: low ? 'row-warn' : '' },
      h('td', {}, house.name, low ? h('span', { className: 'tag tag-warn' }, '受精率偏低') : null),
      h('td', {}, String(a.batches)),
      h('td', {}, String(a.trays)),
      h('td', {}, String(a.total)),
      h('td', { className: low ? 'warn-text' : '' }, a.total ? fmtPct(fr) : '-'),
      h('td', {}, a.total ? fmtPct(a.byClass.clear / a.total) : '-'),
      h('td', {}, a.total ? fmtPct(a.byClass.earlyDead / a.total) : '-'),
      h('td', {}, a.total ? fmtPct(a.byClass.lateDead / a.total) : '-'),
      h('td', {}, a.total ? fmtPct(a.cracks / a.total) : '-'),
      h('td', { className: 'bar-cell' }, h('div', { className: 'bar' }, ...CLASSES.map(bar))),
    );
  });

  const worst = db.houses
    .map((hh) => ({ hh, a: agg.get(hh.id)! }))
    .filter((x) => x.a.total > 0)
    .sort((x, y) => x.a.byClass.fertile / x.a.total - y.a.byClass.fertile / y.a.total)[0];

  return h('div', {},
    h('h2', {}, '种鸡舍统计'),
    worst && worst.a.byClass.fertile / worst.a.total < LOW_FERTILITY
      ? h('div', { className: 'card alert' },
          `⚠ ${worst.hh.name} 受精率 ${fmtPct(worst.a.byClass.fertile / worst.a.total)}，低于 ${fmtPct(LOW_FERTILITY, 0)} 警戒线，` +
          `涉及 ${worst.a.batches} 个批次 ${worst.a.trays} 盘，建议排查该舍种鸡周龄、公母比例与饲料。`)
      : h('div', { className: 'card ok' }, '各种鸡舍受精率均在警戒线以上。'),
    h('div', { className: 'card' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '种鸡舍'), h('th', {}, '批次'), h('th', {}, '盘数'), h('th', {}, '照蛋数'),
          h('th', {}, '受精率'), h('th', {}, '无精'), h('th', {}, '早死胚'), h('th', {}, '晚死胚'),
          h('th', {}, '裂纹率'), h('th', {}, '构成'),
        )),
        h('tbody', {}, ...rows),
      ),
    ),
    h('p', { className: 'muted' }, '统计口径：已分析蛋盘的机器判别结果，经复核页人工修正后自动生效。受精率 = 受精 / 照蛋总数。'),
  );
}

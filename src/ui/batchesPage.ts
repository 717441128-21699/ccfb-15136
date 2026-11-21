/** 入孵批次页：批次建管、每批盘数、分析进度 */
import { h, fmtPct, fmtDate } from './components';
import { addBatch, effectiveEggs, houseOf, loadDb, resetDb, save, traysOf } from '../store';
import { Batch } from '../types';

export function batchesPage(): HTMLElement {
  const db = loadDb();

  const codeInput = h('input', { value: `PI${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(db.batches.length + 1).padStart(2, '0')}` });
  const houseSel = h('select', {},
    ...db.houses.map((hh) => h('option', { value: hh.id }, hh.name)),
  );
  const dateInput = h('input', { type: 'date', value: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10) });
  const dayInput = h('input', { type: 'number', value: 7, min: 4, max: 12, style: 'width:64px' });
  const trayInput = h('input', { type: 'number', value: 4, min: 1, max: 40, style: 'width:64px' });

  const form = h('div', { className: 'card form-row' },
    h('label', {}, '批次号 ', codeInput),
    h('label', {}, '种鸡舍 ', houseSel),
    h('label', {}, '入孵日期 ', dateInput),
    h('label', {}, '照蛋胚龄 ', dayInput),
    h('label', {}, '盘数 ', trayInput),
    h('button', {
      className: 'primary',
      onclick: () => {
        addBatch({
          code: codeInput.value.trim() || '未命名',
          houseId: houseSel.value,
          setDate: dateInput.value,
          day: Math.max(4, Math.min(12, Number(dayInput.value) || 7)),
          trayCount: Math.max(1, Math.min(40, Number(trayInput.value) || 1)),
          notes: '',
        });
        location.reload();
      },
    }, '＋ 新建批次'),
    h('button', {
      className: 'ghost',
      onclick: () => {
        if (confirm('清空全部数据并恢复演示初始状态？')) { resetDb(); location.reload(); }
      },
    }, '重置演示数据'),
  );

  const rows = db.batches.map((b: Batch) => {
    const trays = traysOf(b.id);
    const analyzed = trays.filter((t) => db.results[t.id]);
    let fertileSum = 0, eggSum = 0;
    for (const t of analyzed) {
      const eggs = effectiveEggs(t.id);
      fertileSum += eggs.filter((e) => e.label === 'fertile').length;
      eggSum += eggs.length;
    }
    return h('tr', {},
      h('td', {}, b.code),
      h('td', {}, houseOf(b)?.name ?? '-'),
      h('td', {}, fmtDate(b.setDate)),
      h('td', {}, `${b.day} 天`),
      h('td', {}, `${analyzed.length}/${trays.length}`),
      h('td', {}, eggSum ? fmtPct(fertileSum / eggSum) : '-'),
      h('td', {},
        h('a', { href: `#/candling/${b.id}`, className: 'btn-link' }, '去照蛋 →'),
      ),
    );
  });

  return h('div', {},
    h('h2', {}, '入孵批次'),
    form,
    h('div', { className: 'card' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '批次号'), h('th', {}, '种鸡舍'), h('th', {}, '入孵日期'),
          h('th', {}, '照蛋胚龄'), h('th', {}, '已分析盘'), h('th', {}, '受精率'), h('th', {}, ''),
        )),
        h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: 7, className: 'muted' }, '暂无批次，请先新建'))])),
      ),
    ),
    h('p', { className: 'muted' }, '说明：每盘 150 枚（10×15）。新建批次后进入"照蛋结果"页逐盘生成/导入照蛋图并运行分析。'),
  );
}

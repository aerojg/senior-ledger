// S6 내역: 월 이동, 일자별 목록, 항목을 눌러 고치기·삭제 (화면흐름 v1.0)
// 삭제는 삭제 표시만 하므로 확인 질문 없이 바로 하고, 화면 위에 [되돌리기]를 보인다 (U8).
import { el } from './dom.js';
import { formatWon, formatDateKo } from './format.js';
import { dbGetAll } from '../storage/db.js';
import { todayStr, periodKeyOf, periodRange, shiftPeriodKey } from '../storage/dates.js';
import { listTransactionsByPeriod, sumTransactions, restoreTransaction } from '../storage/transactions.js';

function periodTitle(key) {
  const [y, m] = key.split('-');
  return y + '년 ' + Number(m) + '월';
}

export async function historyView(ctx, path, params) {
  const startDay = ctx.settings.monthStartDay || 1;
  const nowKey = periodKeyOf(todayStr(), startDay);
  const key = /^\d{4}-\d{2}$/.test(params.key || '') ? params.key : nowKey;

  const categories = await dbGetAll(ctx.db, 'categories');
  const nameOf = (id) => (categories.find((c) => c.id === id) || {}).name || '';

  const box = el('section', {});
  const undo = ctx.undo || null;
  ctx.undo = null;                       // 한 번 보여 준 뒤에는 지운다
  let undone = false;

  async function paint() {
    const rows = await listTransactionsByPeriod(ctx.db, key, startDay);
    const sums = sumTransactions(rows);
    const range = periodRange(key, startDay);

    const nav = el('div', { class: 'month-nav' },
      el('a', { class: 'btn', href: '#/history/' + shiftPeriodKey(key, -1) }, '◀ 이전 달'),
      key < nowKey
        ? el('a', { class: 'btn', href: '#/history/' + shiftPeriodKey(key, 1) }, '다음 달 ▶')
        : el('span', { class: 'btn disabled', 'aria-disabled': 'true' }, '다음 달 ▶'));

    const summary = el('div', { class: 'card' },
      el('p', { class: 'muted' }, startDay === 1 ? '쓴 돈' : '쓴 돈 (' + range.start.slice(5).replace('-', '/') + ' ~ ' + range.end.slice(5).replace('-', '/') + ')'),
      el('p', { class: 'big-number' }, formatWon(sums.expense)),
      sums.income > 0 ? el('p', { class: 'muted' }, '들어온 돈 ' + formatWon(sums.income)) : null,
      el('p', { class: 'muted' }, '기록 ' + rows.length + '건'));

    const banner = (undo && !undone) ? el('div', { class: 'banner', role: 'status' },
      el('span', {}, undo.text + ' 삭제했어요.'),
      el('button', {
        type: 'button', class: 'link-btn',
        onclick: async () => { await restoreTransaction(ctx.db, undo.id); undone = true; paint(); },
      }, '되돌리기')) : null;

    let body;
    if (rows.length === 0) {
      body = el('div', { class: 'card' },
        el('p', {}, '이 달에는 기록이 없어요.'),
        el('a', { class: 'btn primary', href: '#/write' }, '직접 쓰기'));
    } else {
      const byDate = new Map();
      for (const r of rows) {
        if (!byDate.has(r.date)) byDate.set(r.date, []);
        byDate.get(r.date).push(r);
      }
      const dates = [...byDate.keys()].sort().reverse();   // 최근 날짜가 위
      body = dates.map((d) => {
        const list = byDate.get(d);
        const dayExpense = list.filter((r) => r.type === 'expense').reduce((a, r) => a + r.amount, 0);
        return el('div', { class: 'day' },
          el('h2', { class: 'day-title' },
            el('span', {}, formatDateKo(d)),
            dayExpense > 0 ? el('span', { class: 'muted day-sum' }, formatWon(dayExpense)) : null),
          list.map((r) => {
            const title = r.type === 'transfer' ? '이체' : (nameOf(r.categoryId) || '기타');
            const sub = [r.merchant, r.memo].filter(Boolean).join(' · ');
            const kind = r.type === 'income' ? '수입 ' : '';
            return el('a', { class: 'item', href: '#/edit/' + r.id },
              el('div', { class: 'item-main' },
                el('p', { class: 'item-title' }, (r.type === 'income' ? '[수입] ' : r.type === 'transfer' ? '[이체] ' : '') + title),
                sub ? el('p', { class: 'muted small' }, sub) : null),
              el('p', { class: 'item-amount' }, kind + formatWon(r.amount)));
          }));
      });
    }

    box.replaceChildren(...[
      el('h1', {}, '내역'),
      el('h2', { class: 'period' }, periodTitle(key)),
      nav, banner, summary, body,
      el('a', { class: 'btn', href: '#/home' }, '홈으로'),
    ].flat().filter(Boolean));
  }

  await paint();
  return box;
}

/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// S6 내역: 월 이동, 일자별 목록, 항목을 눌러 고치기·삭제 (화면흐름 v1.0)
// 삭제는 삭제 표시만 하므로 확인 질문 없이 바로 하고, 화면 위에 [되돌리기]를 보인다 (U8).
import { el } from './dom.js';
import { formatWon, formatDateKo } from './format.js';
import { dbGetAll } from '../storage/db.js';
import { restoreWithJar } from '../storage/jarUse.js'; // JAR-LINK-ENTRY
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
    const offCount = rows.filter((r) => r.statsOff).length;   // 통계에서 뺀 칸의 기록 (D140)

    const nav = el('div', { class: 'month-nav' },
      el('a', { class: 'btn', href: '#/history/' + shiftPeriodKey(key, -1) }, '◀ 이전 달'),
      key < nowKey
        ? el('a', { class: 'btn', href: '#/history/' + shiftPeriodKey(key, 1) }, '다음 달 ▶')
        : el('span', { class: 'btn disabled', 'aria-disabled': 'true' }, '다음 달 ▶'));

    const cnt = (type) => rows.filter((r) => r.type === type && !r.fromReserve && !r.statsOff).length;   // 미리 떼어 둔 돈으로 쓴 기록은 쓴 돈 건수에서 뺀다 (D113)
    const period = startDay === 1 ? '' : range.start.slice(5).replace('-', '/') + ' ~ ' + range.end.slice(5).replace('-', '/');
    const panel = (label, amount, count, kind) => el('div', { class: 'cmp-panel ' + kind },
      el('p', { class: 'cmp-label' }, label),
      el('p', { class: 'cmp-amount' }, formatWon(amount)),
      el('p', { class: 'cmp-count' }, count + '건'));
    const summary = el('div', { class: 'card' },
      period ? el('p', { class: 'meta' }, '기간 ' + period) : null,
      el('div', { class: 'cmp' },
        panel('쓴 돈', sums.expense, cnt('expense'), 'out'),
        panel('받은 돈', sums.income, cnt('income'), 'in')),
      el('p', { class: 'meta' }, '전체 기록 ' + rows.filter((r) => !r.statsOff).length + '건'),
      offCount > 0 ? el('p', { class: 'note' }, '통계에서 뺀 칸의 기록 ' + offCount + '건은 위 "쓴 돈"에 넣지 않았어요. 아래 목록에는 "통계 제외"로 보여요.') : null,
      sums.fromReserve > 0
        ? el('p', { class: 'note' }, '미리 떼어 둔 돈으로 쓴 ' + formatWon(sums.fromReserve) + '은 위 "쓴 돈"에 넣지 않았어요. 모을 때 이미 쓴 돈으로 적었어요.')
        : null);

    const banner = (undo && !undone) ? el('div', { class: 'banner', role: 'status' },
      el('span', {}, undo.text + ' 삭제했어요.'),
      el('button', {
        type: 'button', class: 'link-btn',
        onclick: async () => { try { await restoreWithJar(ctx.db, undo.id); undone = true; } catch (e) { console.error(e); undo.text = e.userMessage || '되돌리지 못했어요. 한 번 더 눌러 주세요.'; } paint(); /* JAR-LINK-ENTRY */ },
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
        const dayExpense = list.filter((r) => r.type === 'expense' && !r.fromReserve && !r.statsOff).reduce((a, r) => a + r.amount, 0);
        return el('div', { class: 'day' },
          el('h2', { class: 'day-title' },
            el('span', {}, formatDateKo(d)),
            dayExpense > 0 ? el('span', { class: 'muted day-sum' }, formatWon(dayExpense)) : null),
          list.map((r) => {
            const title = r.type === 'transfer' ? '이체' : r.reserveDeposit ? '저금통' : (nameOf(r.categoryId) || '기타');   // 적립은 이름표가 길어 제목을 짧게 둔다(접은 화면에서 두 줄로 꺾이지 않게). 칸 이름은 아래 메모에 있다
            const sub = [r.merchant, r.memo].filter(Boolean).join(' · ');
            // 이름표: 세 이름표 모두 두 글자에만 색 바탕을 깐다: [수입] 노랑 바탕에 짙은 글씨, [지출] 빨강 바탕에 흰 글씨, [지출 적립](미리 모으는 칸에 적립한 지출유보적립금) 초록 바탕에 흰 글씨. 두 글자에만 색을 넣고 글자로도 구분한다 (U5)
            const TAG = { income: ['수입', 'color:#4a3500; background:#ffd600;'], expense: ['지출', 'color:#ffffff; background:#b71c1c;'], deposit: ['지출 적립', 'color:#ffffff; background:#1b5e20;'] };
            const tagKind = r.type === 'income' ? 'income' : r.type === 'transfer' ? null : (r.reserveDeposit ? 'deposit' : 'expense');
            const tag = tagKind
              ? ['[', el('span', { style: TAG[tagKind][1] + ' font-weight: 800; padding: 0 4px; border-radius: 3px;' }, TAG[tagKind][0]), '] ']
              : '[이체] ';
            // 긴 이름표는 제목 줄에 넣지 않고 아래 줄에 따로 둔다: 제목 줄은 짧게 두어 금액이 글 가운데로 밀려 들어가지 않게 한다
            const note = (r.fromReserve ? (r.offPurpose ? '미리 떼어 둔 돈으로 씀 · 용도 밖' : '미리 떼어 둔 돈으로 씀')
              : r.reserveDeposit ? '미리 떼어 둔 돈' : '') + (r.statsOff ? ' · 통계 제외' : '');
            return el('a', { class: 'item', href: '#/edit/' + r.id },
              el('div', { class: 'item-main' },
                el('div', { class: 'item-line' },
                  el('p', { class: 'item-title' }, tag, title),
                  el('p', { class: 'item-amount' }, formatWon(r.amount))),
                note ? el('p', { class: 'meta' }, note) : null,
                sub ? el('p', { class: 'meta' }, sub) : null));
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

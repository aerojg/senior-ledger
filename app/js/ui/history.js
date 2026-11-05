/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// S6 내역: 월 이동, 일자별 목록, 항목을 눌러 고치기·삭제 (화면흐름 v1.0)
// 삭제는 삭제 표시만 하므로 확인 질문 없이 바로 하고, 화면 위에 [되돌리기]를 보인다 (U8).
import { el } from './dom.js';
import { foldRow } from './fold.js';
import { PAY_LABEL } from '../analysis/month.js';
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
      el('p', { class: 'meta meta-join' }, '전체 기록 ' + rows.filter((r) => !r.statsOff).length + '건'),
      el('p', { class: 'meta meta-join-end' }, '(내역에 기록된 날짜 기준)'),
      offCount > 0 ? el('p', { class: 'note' }, '통계에서 뺀 칸의 기록 ' + offCount + '건은 위 "쓴 돈"에 넣지 않았어요. 아래 목록에는 "통계 제외"로 보여요.') : null,
      sums.fromReserve > 0
        ? el('p', { class: 'note' }, '미리 떼어 둔 돈에서 사용한 ' + formatWon(sums.fromReserve) + '은 위 "쓴 돈"에 넣지 않았어요. 모을 때 이미 "쓴 돈"으로 적었어요.')
        : null);

    const banner = (undo && !undone) ? el('div', { class: 'banner', role: 'status' },
      el('span', {}, undo.text + ' 삭제했어요.'),
      el('button', {
        type: 'button', class: 'link-btn',
        onclick: async () => { try { await restoreWithJar(ctx.db, undo.id); undone = true; } catch (e) { console.error(e); undo.text = e.userMessage || '되돌리지 못했어요. 한 번 더 눌러 주세요.'; } paint(); /* JAR-LINK-ENTRY */ },
      }, '되돌리기')) : null;

    // ---- 보는 방법 (2026-11-06): 날짜별 / 구분별 / 분류별 / 결제방법별. 묶음마다 [펴기 ▼] / [접기 ▲] ----
    const MODES = [['date', '날짜별'], ['kind', '구분별'], ['cat', '분류별'], ['pay', '결제방법별']];
    const mode = MODES.some((m) => m[0] === ctx.historyMode) ? ctx.historyMode : 'date';
    if (!ctx.historyOpen) ctx.historyOpen = new Map();     // 묶음을 펴 둔 상태: 기록을 고치고 돌아와도 그대로 둔다
    const counted = (r) => r.type === 'expense' && !r.fromReserve && !r.statsOff;   // 위 "쓴 돈"에 들어가는 기록
    const KIND_NAME = { fixed: '고정비', variable: '변동비', oneoff: '일회성' };
    const kindOf = (r) => (r.costType === 'fixed' ? 'fixed' : r.costType === 'oneoff' ? 'oneoff' : 'variable');
    const TAG = { income: ['수입', 'color:#4a3500; background:#ffd600;'], expense: ['지출', 'color:#ffffff; background:#b71c1c;'], deposit: ['지출 적립', 'color:#ffffff; background:#1b5e20;'] };

    const itemOf = (r, withDate) => {
      const title = r.type === 'transfer' ? '이체' : r.reserveDeposit ? '저금통' : (nameOf(r.categoryId) || '기타');
      const sub = [r.merchant, r.memo].filter(Boolean).join(' · ');
      // 이름표는 두 글자에만 색 바탕을 깐다: [수입] 노랑, [지출] 빨강, [지출 적립] 초록. [ ]는 누르는 것이라 괄호 없이 색 표지만 둔다
      const tagKind = r.type === 'income' ? 'income' : r.type === 'transfer' ? null : (r.reserveDeposit ? 'deposit' : 'expense');
      const tag = tagKind
        ? [el('span', { style: TAG[tagKind][1] + ' font-weight: 800; padding: 0 4px; border-radius: 3px;' }, TAG[tagKind][0]), ' ']
        : '';
      // 긴 이름표는 제목 줄에 넣지 않고 아래 줄에 따로 둔다: 제목 줄은 짧게 두어 금액이 글 가운데로 밀려 들어가지 않게 한다
      const note = (r.fromReserve ? (r.offPurpose ? '미리 떼어 둔 돈으로 씀 · 용도 밖' : '미리 떼어 둔 돈으로 씀')
        : r.reserveDeposit ? '미리 떼어 둔 돈' : '') + (r.statsOff ? ' · 통계 제외' : '');
      return el('a', { class: 'item', href: '#/edit/' + r.id },
        el('div', { class: 'item-main' },
          el('div', { class: 'item-line' },
            el('p', { class: 'item-title' }, tag, title),
            el('p', { class: 'item-amount' }, formatWon(r.amount))),
          withDate ? el('p', { class: 'meta' }, formatDateKo(r.date)) : null,
          note ? el('p', { class: 'meta' }, note) : null,
          sub ? el('p', { class: 'meta' }, sub) : null));
    };

    // 묶음 만들기: [{ id, name, list }]
    const newest = (a, c) => (a.date === c.date ? (c.createdAt || 0) - (a.createdAt || 0) : a.date < c.date ? 1 : -1);
    const bucket = (pick) => {
      const m = new Map();
      for (const r of rows) {
        const g = pick(r);
        if (!m.has(g.id)) m.set(g.id, { id: g.id, name: g.name, list: [] });
        m.get(g.id).list.push(r);
      }
      return [...m.values()];
    };
    const money = (list) => list.filter((r) => counted(r) || (r.type === 'income' && !r.statsOff) || (r.type === 'transfer' && !r.statsOff)).reduce((a, r) => a + r.amount, 0);
    let groups;
    if (mode === 'date') {
      groups = bucket((r) => ({ id: r.date, name: formatDateKo(r.date) })).sort((x, y) => (x.id < y.id ? 1 : -1));   // 최근 날짜가 위
    } else if (mode === 'kind') {
      const ORDER = ['fixed', 'variable', 'oneoff', 'income', 'transfer', 'fromReserve', 'off'];
      const NAME = { ...KIND_NAME, income: '받은 돈', transfer: '이체', fromReserve: '미리 떼어 둔 돈에서 사용한 기록', off: '통계에서 뺀 칸의 기록' };
      groups = bucket((r) => {
        const id = r.statsOff ? 'off' : r.type === 'income' ? 'income' : r.type === 'transfer' ? 'transfer' : r.fromReserve ? 'fromReserve' : kindOf(r);
        return { id, name: NAME[id] };
      }).sort((x, y) => ORDER.indexOf(x.id) - ORDER.indexOf(y.id));
    } else if (mode === 'cat') {
      groups = bucket((r) => {
        if (r.type === 'transfer') return { id: 'transfer', name: '이체' };
        const n = nameOf(r.categoryId) || '기타';
        return { id: (r.type === 'income' ? 'in:' : 'ex:') + n, name: n };
      }).sort((x, y) => {
        const rank = (g) => (g.id === 'transfer' ? 2 : g.id.startsWith('in:') ? 1 : 0);   // 쓴 돈 분류 → 받은 돈 분류 → 이체 순, 같은 쪽 안에서는 금액이 큰 순
        return rank(x) - rank(y) || money(y.list) - money(x.list);
      });
    } else {
      groups = bucket((r) => {
        if (r.type === 'income') return { id: 'income', name: '받은 돈' };
        if (r.type === 'transfer') return { id: 'transfer', name: '이체' };
        if (r.reserveDeposit || r.fromReserve || r.statsOff || r.source === 'settle') return { id: 'none', name: '방법 없음' };
        const id = PAY_LABEL[r.payMethod] ? r.payMethod : 'etc';
        return { id, name: PAY_LABEL[id] };
      }).sort((x, y) => {
        const last = (g) => (['income', 'transfer', 'none'].includes(g.id) ? 1 : 0);
        return last(x) - last(y) || money(y.list) - money(x.list);
      });
    }
    const metaOf = (g) => {
      const l = g.list;
      if (mode === 'date') {
        const day = l.filter(counted).reduce((a, r) => a + r.amount, 0);
        return l.length + '건' + (day > 0 ? ' · 하루 합계 ' + formatWon(day) : '');
      }
      const sum = (f) => l.filter(f).reduce((a, r) => a + r.amount, 0);
      const parts = [
        [sum(counted), '쓴 돈'],
        [sum((r) => r.type === 'income' && !r.statsOff), '받은 돈'],
        [sum((r) => r.type === 'transfer' && !r.statsOff), '이체'],
        [sum((r) => r.type === 'expense' && r.fromReserve && !r.statsOff), '꺼내 사용한 돈'],
        [sum((r) => r.statsOff), '통계 제외'],
      ].filter((x) => x[0] > 0).map((x) => x[1] + ' ' + formatWon(x[0]));
      return [l.length + '건', ...parts].join(' · ');
    };

    const openKey = (g) => key + '|' + mode + '|' + g.id;
    const isOpen = (g) => (ctx.historyOpen.has(openKey(g)) ? ctx.historyOpen.get(openKey(g)) : mode === 'date');   // 날짜별은 펴 두고, 나머지는 접어 둔다
    const groupEl = (g) => {
      const list = [...g.list].sort(mode === 'date' ? () => 0 : newest);
      const items = el('div', { class: 'group-body' }, ...list.map((r) => itemOf(r, mode !== 'date')));
      let open = isOpen(g);
      const head = foldRow(() => {
        open = !open;
        ctx.historyOpen.set(openKey(g), open);
        items.toggleAttribute('hidden', !open);
        head.setState(g.name, open);
        head.classList.toggle('is-open', open);
      });
      head.classList.add('group-head');
      head.setState(g.name, open);
      head.classList.toggle('is-open', open);
      items.toggleAttribute('hidden', !open);
      return el('div', { class: 'day group' }, head, el('p', { class: 'meta group-meta' }, metaOf(g)), items);
    };

    let body;
    if (rows.length === 0) {
      body = el('div', { class: 'card' },
        el('p', {}, '이 달에는 기록이 없어요.'),
        el('a', { class: 'btn primary', href: '#/write' }, '직접 쓰기'));
    } else {
      const modeBtn = ([id, label]) => {
        const on = mode === id;
        const b = el('button', { type: 'button', class: 'btn seg' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false' }, (on ? '✓ ' : '') + label);
        b.addEventListener('click', () => { ctx.historyMode = id; paint(); });
        return b;
      };
      const allOpen = groups.length > 0 && groups.every(isOpen);
      const allRow = foldRow(() => {
        const next = !groups.every(isOpen);
        for (const g of groups) ctx.historyOpen.set(openKey(g), next);
        paint();
      });
      allRow.setState('모든 묶음', allOpen);
      body = [
        el('div', { class: 'card' },
          el('p', { class: 'kicker' }, '보는 방법'),
          el('div', { class: 'month-nav mode-nav' }, ...MODES.map(modeBtn))),
        groups.length > 1 ? allRow : null,
        ...groups.map(groupEl),
      ];
    }

    box.replaceChildren(...[
      el('h1', {}, '내역'),
      el('h2', { class: 'period' }, periodTitle(key)),
      nav, banner, summary, body,
    ].flat().filter(Boolean));
  }

  await paint();
  return box;
}

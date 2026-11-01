/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 월 결산 계산 (말풀이틀_시니어가계부.md v1.0의 1번 기준선, 3번 신호등)
// 화면을 모르는 순수 계산이라 시험 화면에서 그대로 시험한다. 이체는 지출 분석에서 뺀다 (D31).
// 숫자 기준(90%, 120%, 5만 원)은 제안값이며 시니어 시험 뒤 조정한다 (Q32).

export const BASELINE_MIN = 50000;   // 기준선이 이보다 작은 분류는 신호를 내지 않는다

// 평소 지출로 세는 기록: 지출이고, 필수·일회성·응원 소비가 아닌 것 (말풀이틀 1번)
export function isCountable(r) {
  return r.type === 'expense' && !r.essential && r.costType !== 'oneoff' && !r.isJoy && !r.fromReserve;
}

// 지출 방법 이름 (직접 쓰기·문자 확인의 결제 방법과 같다). 값이 없거나 모르는 값은 기타로 센다.
export const PAY_LABEL = { cash: '현금', debit: '체크카드', credit: '신용카드', account: '계좌이체', pay: '간편결제', etc: '기타' };
const PAY_ORDER = ['cash', 'debit', 'credit', 'account', 'pay', 'etc'];
const payIdOf = (r) => (PAY_LABEL[r.payMethod] ? r.payMethod : 'etc');
// map: 방법 -> { amount, count }
function sortPay(map) {
  return PAY_ORDER.filter((id) => map.has(id) && map.get(id).amount > 0)
    .map((id) => ({ id, name: PAY_LABEL[id], amount: map.get(id).amount, count: map.get(id).count }))
    .sort((a, b) => b.amount - a.amount);
}

// 한 달의 기록 -> 합계, 고정비·변동비·일회성, 분류별 금액, 지출 방법별 금액
// 지출 방법별 금액(byPay)에는 앱이 대신 적은 기록(미리 모으는 칸에 저금한 돈, 연말 정산)을 넣지 않는다. 그 금액은 payExcluded에 따로 둔다.
// 미리 모은 돈으로 쓴 기록(fromReserve)은 적립할 때 이미 지출로 잡았으므로 쓴 돈 합계에 넣지 않고 따로 모아 둔다 (D113).
// reserveDeposit은 미리 모으는 칸에 저금한 돈(지출로 잡힌 것)의 합계로, 쓴 돈 안에 들어 있는 금액이다.
export function summarizeMonth(rows, categories = []) {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const s = { income: 0, expense: 0, transfer: 0, fixed: 0, variable: 0, oneoff: 0, fromReserve: 0, reserveDeposit: 0, count: rows.length, byCategory: [], byPay: [], payExcluded: 0 };
  const by = new Map();
  const payBy = new Map();
  for (const r of rows) {
    if (r.type === 'income') { s.income += r.amount; continue; }
    if (r.type === 'transfer') { s.transfer += r.amount; continue; }
    if (r.type !== 'expense') continue;
    if (r.fromReserve) { s.fromReserve += r.amount; continue; }
    if (r.reserveDeposit) s.reserveDeposit += r.amount;
    s.expense += r.amount;
    if (r.reserveDeposit || r.source === 'settle') s.payExcluded += r.amount;
    else {
      const cur = payBy.get(payIdOf(r)) || { amount: 0, count: 0 };
      cur.amount += r.amount; cur.count += 1;
      payBy.set(payIdOf(r), cur);
    }
    if (r.costType === 'fixed') s.fixed += r.amount;
    else if (r.costType === 'oneoff') s.oneoff += r.amount;
    else s.variable += r.amount;
    const cat = catById.get(r.categoryId);
    const g = by.get(r.categoryId) || {
      id: r.categoryId, name: (cat && cat.name) || '기타', amount: 0, countable: 0,
      essentialCat: !!(cat && cat.essentialDefault),
    };
    g.amount += r.amount;
    if (isCountable(r)) g.countable += r.amount;
    by.set(r.categoryId, g);
  }
  s.byCategory = [...by.values()].sort((a, b) => b.amount - a.amount);
  s.byPay = sortPay(payBy);
  s.balance = s.income - s.expense;
  return s;
}

// 평소 기준선: 분류별 최근 3개월 평균. 기록(지출)이 있는 달만 평균에 넣는다 (1~3개월).
// prev: [{ key, summary }] 이전 달들. 반환 months=0이면 첫 달이다.
export function buildBaseline(prev) {
  const used = prev.filter((p) => p.summary.expense > 0).slice(0, 3);
  const sums = new Map();
  for (const p of used) {
    for (const g of p.summary.byCategory) sums.set(g.id, (sums.get(g.id) || 0) + g.countable);
  }
  const avg = new Map();
  for (const [id, total] of sums) avg.set(id, used.length ? Math.round(total / used.length) : 0);
  return { months: used.length, keys: used.map((p) => p.key), avg };
}

// 월 균형 신호: 이체를 뺀 지출 ÷ 수입 (수입이 없으면 신호 없음). 정수로만 비교한다.
export function balanceSignal(income, expense) {
  if (!(income > 0)) return null;
  if (expense * 10 <= income * 9) return 'green';
  if (expense <= income) return 'yellow';
  return 'red';
}

// 분류별 신호: 이번 달 평소 지출 ÷ 기준선. 기준선이 없거나 5만 원 미만이면 신호 없음.
export function categorySignal(amount, baseline) {
  if (baseline == null || baseline < BASELINE_MIN) return null;
  if (amount <= baseline) return 'green';
  if (amount * 5 <= baseline * 6) return 'yellow';
  return 'red';
}

// 평소보다 늘어난 항목을 늘어난 금액이 큰 순서로 돌려준다 (필수 분류, 기준 없는 분류 제외)
export function risingItems(summary, baseline, limit = 2) {
  const out = [];
  for (const g of summary.byCategory) {
    if (g.essentialCat) continue;
    const base = baseline.avg.get(g.id);
    if (base == null || base < BASELINE_MIN) continue;
    const signal = categorySignal(g.countable, base);
    if (signal === 'yellow' || signal === 'red') out.push({ id: g.id, name: g.name, amount: g.countable, base, over: g.countable - base, signal });
  }
  return out.sort((a, b) => b.over - a.over).slice(0, limit);
}

// 기간 선택: 고른 달들의 표와 누적. list = [{ key, summary }] 오래된 달 -> 새 달 순서.
// 기록이 없는 달(hasData=false)은 표에 "기록 없음"으로 두고 합계·평균에는 넣지 않는다.
// 남은 돈은 수입을 적은 달만 계산한다. 누적 쓴 돈은 그 달까지 더한 쓴 돈이다.
export function buildPeriodTable(list) {
  let run = 0;
  const rows = list.map(({ key, summary: s }) => {
    const hasData = s.count > 0;
    if (hasData) run += s.expense;
    return {
      key, hasData,
      expense: s.expense,
      income: s.income,
      balance: s.income > 0 ? s.income - s.expense : null,
      cumExpense: run,
    };
  });
  const used = rows.filter((r) => r.hasData);
  const total = {
    months: used.length,
    expense: used.reduce((a, r) => a + r.expense, 0),
    income: used.reduce((a, r) => a + r.income, 0),
    balance: used.reduce((a, r) => a + (r.balance == null ? 0 : r.balance), 0),
    balanceMonths: used.filter((r) => r.balance != null).length,
  };
  total.avgExpense = used.length ? Math.round(total.expense / used.length) : 0;
  return { rows, total };
}

// 연간 결산: 한 해의 달별 summary를 합쳐 분류별 순위를 만든다. 반환은 [{ id, name, amount }] 금액 큰 순서.
export function mergeCategories(summaries) {
  const by = new Map();
  for (const s of summaries) {
    for (const g of s.byCategory) {
      const cur = by.get(g.id) || { id: g.id, name: g.name, amount: 0 };
      cur.amount += g.amount;
      by.set(g.id, cur);
    }
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount);
}

// 여러 달의 지출 방법별 금액을 합친다 (기간 선택, 연간 결산). 앱이 대신 적은 기록의 금액(payExcluded)도 함께 센다.
export function mergePay(summaries) {
  const m = new Map();
  let excluded = 0;
  for (const s of summaries) {
    excluded += s.payExcluded || 0;
    for (const g of (s.byPay || [])) {
      const cur = m.get(g.id) || { amount: 0, count: 0 };
      cur.amount += g.amount; cur.count += (g.count || 0);
      m.set(g.id, cur);
    }
  }
  return { rows: sortPay(m), excluded };
}

// 은퇴 후 생활비 환산(S10): 올해 기록이 있는 달의 "생활비"(쓴 돈에서 일회성 지출과 미리 모으는 돈을 뺀 것) 평균에
// 늘어날 돈(up)을 더하고 줄어들 돈(down)을 뺀다. 단순 계산이며 투자·금융 자문이 아니다. list = [{ key, summary }]
export function buildRetire(list, up = 0, down = 0) {
  const bases = list
    .filter((x) => x.summary.count > 0)
    .map((x) => x.summary.expense - x.summary.oneoff - x.summary.reserveDeposit)
    .filter((b) => b > 0);
  const base = bases.length ? Math.round(bases.reduce((a, b) => a + b, 0) / bases.length) : 0;
  const monthly = Math.max(0, base + (up || 0) - (down || 0));
  return { months: bases.length, base, up: up || 0, down: down || 0, monthly, yearly: monthly * 12, five: monthly * 60, ten: monthly * 120 };
}

// 연말 정산 보기(D114): 미리 모으는 칸마다 그해 적립(저금한 돈), 집행(쓴 돈), 차이를 계산한다. 남은 돈 모음과 지운 칸은 뺀다.
// jars = jars 저장소 전체, entries = jarEntries 저장소 전체. 차이 > 0이면 남은 잔액, < 0이면 먼저 쓴 돈이다.
export function buildJarYear(jars, entries, year) {
  const y = String(year);
  const rows = [];
  for (const j of jars) {
    if (j.deletedAt || j.kind === 'surplus') continue;
    let moved = 0, used = 0, n = 0;
    for (const e of entries) {
      if (e.jarId !== j.id || e.deletedAt || e.settle || String(e.date).slice(0, 4) !== y) continue;   // 연말 정산이 남긴 기록(settle)은 세지 않는다
      if (e.kind === 'moved') { moved += e.amount; n++; }
      else if (e.kind === 'used') { used += e.amount; n++; }
    }
    if (n === 0) continue;
    rows.push({ id: j.id, name: j.name, purpose: j.purpose || '', moved, used, diff: moved - used, done: j.status === 'done' });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { rows, totalMoved: rows.reduce((a, r) => a + r.moved, 0), totalUsed: rows.reduce((a, r) => a + r.used, 0) };
}

// 2년째 비교: 지난해 저장 결과(prev)와 올해 숫자(now)를 견준다. 둘 다 저장 모양(snapshot)이다.
// 쓴 돈과 한 달 평균은 5% 안이면 "비슷해요"(same), 분류는 지난해나 올해 1~5위에 든 분류만 보여 준다.
const trend = (diff, base) => (Math.abs(diff) * 20 <= base ? 'same' : diff > 0 ? 'more' : 'less');
export function buildYearCompare(prev, now) {
  const expenseDiff = now.expense - prev.expense;
  const avgDiff = now.avg - prev.avg;
  const top = (cats) => [...cats].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const ids = new Set([...top(prev.cats), ...top(now.cats)].map((c) => c.id));
  const pm = new Map(prev.cats.map((c) => [c.id, c]));
  const nm = new Map(now.cats.map((c) => [c.id, c]));
  const cats = [...ids].map((id) => {
    const a = pm.get(id), b = nm.get(id);
    const before = a ? a.amount : 0, after = b ? b.amount : 0;
    return { id, name: (b || a).name, prev: before, now: after, diff: after - before, trend: trend(after - before, Math.max(before, 1)) };
  }).sort((x, y) => y.now - x.now || y.prev - x.prev);
  return {
    expenseDiff, expenseTrend: trend(expenseDiff, prev.expense || 1),
    avgDiff, avgTrend: trend(avgDiff, prev.avg || 1),
    cats,
  };
}

// 월 결산 계산 (말풀이틀_시니어가계부.md v1.0의 1번 기준선, 3번 신호등)
// 화면을 모르는 순수 계산이라 시험 화면에서 그대로 시험한다. 이체는 지출 분석에서 뺀다 (D31).
// 숫자 기준(90%, 120%, 5만 원)은 제안값이며 시니어 시험 뒤 조정한다 (Q32).

export const BASELINE_MIN = 50000;   // 기준선이 이보다 작은 분류는 신호를 내지 않는다

// 평소 지출로 세는 기록: 지출이고, 필수·일회성·응원 소비가 아닌 것 (말풀이틀 1번)
export function isCountable(r) {
  return r.type === 'expense' && !r.essential && r.costType !== 'oneoff' && !r.isJoy;
}

// 한 달의 기록 -> 합계, 고정비·변동비·일회성, 분류별 금액
export function summarizeMonth(rows, categories = []) {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const s = { income: 0, expense: 0, transfer: 0, fixed: 0, variable: 0, oneoff: 0, count: rows.length, byCategory: [] };
  const by = new Map();
  for (const r of rows) {
    if (r.type === 'income') { s.income += r.amount; continue; }
    if (r.type === 'transfer') { s.transfer += r.amount; continue; }
    if (r.type !== 'expense') continue;
    s.expense += r.amount;
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

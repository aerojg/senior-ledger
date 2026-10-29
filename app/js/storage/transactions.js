/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 기록(지출·수입·이체) 저장과 조회
// 기준 문서: 데이터구조_시니어가계부.md v1.0 3-1
// 삭제는 삭제 표시(deletedAt)만 한다 (P4). 금액은 정수 원 (P1).

import { dbGet, dbPut, newId } from './db.js';
import { isValidDateStr, periodRange, todayStr, toDateStr } from './dates.js';

const TYPES = ['expense', 'income', 'transfer'];
const MAX_AMOUNT = 9999999999; // 99억 9999만 9999원. 잘못 눌러 너무 큰 숫자가 들어가는 것을 막는다.

// 사용자에게 보여 줄 수 있는 쉬운 말로 오류를 만든다 (U9)
function fail(message) {
  const e = new Error(message);
  e.userMessage = message;
  return e;
}

// 새 기록을 저장한다. 직접 쓰기는 source가 'manual'이다.
export async function addTransaction(db, input) {
  const type = input.type || 'expense';
  if (!TYPES.includes(type)) throw fail('기록 종류를 알 수 없어요.');

  const amount = input.amount;
  if (!Number.isInteger(amount) || amount < 1) throw fail('금액을 1원 이상으로 입력해 주세요.');
  if (amount > MAX_AMOUNT) throw fail('금액이 너무 커요. 숫자를 다시 확인해 주세요.');

  const date = input.date;
  if (!isValidDateStr(date)) throw fail('날짜를 다시 확인해 주세요.');

  let category = null;
  if (type !== 'transfer') {
    category = input.categoryId ? await dbGet(db, 'categories', input.categoryId) : null;
    if (!category) throw fail(type === 'income' ? '어떤 돈인지 골라 주세요.' : '어디에 쓰셨는지 골라 주세요.');
  }

  const now = Date.now();
  const record = {
    id: newId(),
    type,
    date,
    amount,
    categoryId: category ? category.id : '',
    payMethod: input.payMethod || 'etc',
    // 분류의 기본값을 따르되, 건별로 바꾼 값이 있으면 그것을 쓴다
    costType: input.costType || (category ? category.costTypeDefault : 'variable'),
    essential: input.essential !== undefined ? !!input.essential : (category ? category.essentialDefault : false),
    isJoy: !!input.isJoy,
    source: input.source || 'manual',
    createdAt: now,
    updatedAt: now,
  };
  // 선택 칸은 값이 있을 때만 넣는다
  if (input.time) record.time = input.time;
  if (input.merchant) record.merchant = input.merchant;
  if (input.memo) record.memo = input.memo;
  if (input.jarId) record.jarId = input.jarId;
  if (input.transferKind) record.transferKind = input.transferKind;
  if (input.dedupeKey) record.dedupeKey = input.dedupeKey;

  await dbPut(db, 'transactions', record);
  return record;
}

// 기록을 고친다. 바꿀 칸만 넘기면 된다.
export async function updateTransaction(db, id, changes) {
  const old = await dbGet(db, 'transactions', id);
  if (!old) throw fail('고칠 기록을 찾지 못했어요.');
  const next = { ...old, ...changes, id: old.id, createdAt: old.createdAt, updatedAt: Date.now() };

  if (!Number.isInteger(next.amount) || next.amount < 1) throw fail('금액을 1원 이상으로 입력해 주세요.');
  if (next.amount > MAX_AMOUNT) throw fail('금액이 너무 커요. 숫자를 다시 확인해 주세요.');
  if (!isValidDateStr(next.date)) throw fail('날짜를 다시 확인해 주세요.');

  await dbPut(db, 'transactions', next);
  return next;
}

// 삭제 표시만 한다. 기록은 남는다. ("방금 기록 취소"와 내역의 삭제가 모두 이것을 쓴다)
export async function softDeleteTransaction(db, id) {
  const old = await dbGet(db, 'transactions', id);
  if (!old) throw fail('기록을 찾지 못했어요.');
  const next = { ...old, deletedAt: Date.now(), updatedAt: Date.now() };
  await dbPut(db, 'transactions', next);
  return next;
}

// 삭제 표시를 지워 되살린다
export async function restoreTransaction(db, id) {
  const old = await dbGet(db, 'transactions', id);
  if (!old) throw fail('기록을 찾지 못했어요.');
  const next = { ...old, updatedAt: Date.now() };
  delete next.deletedAt;
  await dbPut(db, 'transactions', next);
  return next;
}

// 기간(시작일~끝일)의 기록을 날짜 순서로 돌려준다. 삭제 표시된 것은 뺀다.
export function listTransactionsBetween(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.bound(startDate, endDate);
    const req = db.transaction('transactions').objectStore('transactions').index('date').getAll(range);
    req.onsuccess = () => {
      const rows = req.result
        .filter((r) => !r.deletedAt)
        .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? -1 : 1));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

// 'YYYY-MM' 기간의 기록 (한 달 시작일 설정을 반영)
export function listTransactionsByPeriod(db, periodKey, startDay = 1) {
  const { start, end } = periodRange(periodKey, startDay);
  return listTransactionsBetween(db, start, end);
}

// 합계: 지출과 수입만 센다. 이체는 지출 분석에서 뺀다 (D31)
export function sumTransactions(rows) {
  let income = 0, expense = 0, transfer = 0;
  for (const r of rows) {
    if (r.type === 'income') income += r.amount;
    else if (r.type === 'expense') expense += r.amount;
    else transfer += r.amount;
  }
  return { income, expense, transfer, balance: income - expense };
}

// "자주 쓰는 것": 최근 기간에 직접 입력한 (분류, 금액) 짝 중 여러 번 반복된 것 (화면흐름 S4, Q30)
// 기준은 시험으로 조정한다. 지금은 최근 60일, 2번 이상, 최대 3개.
// 기록에서 계산하므로 데이터 구조는 바뀌지 않는다.
export async function listFrequentPairs(db, { days = 60, minCount = 2, limit = 3 } = {}) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const rows = await listTransactionsBetween(db, toDateStr(since), todayStr());
  const groups = new Map();
  for (const r of rows) {
    if (r.type !== 'expense' || r.source !== 'manual') continue;
    const key = r.categoryId + '|' + r.amount;
    const g = groups.get(key) || { categoryId: r.categoryId, amount: r.amount, count: 0, last: 0 };
    g.count += 1;
    g.last = Math.max(g.last, r.createdAt);
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.count >= minCount)
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, limit);
}

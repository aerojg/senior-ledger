// 문자로 들어온 기록의 저장 보조: 중복 확인, 가맹점 학습, 한꺼번에 저장
// 기준 문서: 문자인식규칙_시니어가계부.md v1.0 (4~6번), 데이터구조 v1.1 3-1·3-3
// 문자 원문은 저장하지 않는다(P3). 저장하는 것은 읽은 결과와 중복 확인용 해시(dedupeKey)뿐이다.

import { dbGet, dbPut, dbGetAllByIndex } from './db.js';
import { addTransaction } from './transactions.js';
import { normalizeMerchant } from '../parser/sms.js';

// 이미 기록된 문자 해시를 찾는다. 삭제 표시한 기록은 "기록돼 있는 것"으로 보지 않는다.
export async function findRecordedKeys(db, keys) {
  const found = new Set();
  for (const key of new Set(keys)) {
    if (!key) continue;
    const rows = await dbGetAllByIndex(db, 'transactions', 'dedupeKey', key);
    if (rows.some((r) => !r.deletedAt)) found.add(key);
  }
  return found;
}

// 학습한 가맹점 (사용자가 지난번에 고른 분류와 기록 종류)
export async function getLearnedMerchant(db, name) {
  const key = normalizeMerchant(name);
  if (!key) return null;
  return (await dbGet(db, 'merchants', key)) || null;
}

// 가맹점 학습: 분류를 한 번 고치면 다음부터 자동 적용한다(확정 기획 2-1).
// 바꾸지 않은 칸은 이전 값을 그대로 둔다.
export async function learnMerchant(db, name, { categoryId, learnedType, learnedTransferKind } = {}) {
  const key = normalizeMerchant(name);
  if (!key) return null;
  const old = await dbGet(db, 'merchants', key);
  const next = {
    normalizedName: key,
    categoryId: categoryId || (old && old.categoryId) || '',
    useCount: (old ? old.useCount : 0) + 1,
    lastUsedAt: Date.now(),
  };
  const type = learnedType || (old && old.learnedType);
  if (type) next.learnedType = type;
  if (learnedType === 'transfer') {
    if (learnedTransferKind) next.learnedTransferKind = learnedTransferKind;
  } else if (learnedType === 'expense') {
    // 지출로 바꿨으니 이전의 이체 종류는 지운다
  } else if (old && old.learnedTransferKind) {
    next.learnedTransferKind = old.learnedTransferKind;
  }
  await dbPut(db, 'merchants', next);
  return next;
}

// 확인 카드에서 확인한 건들을 저장한다.
// entry: { type, date, time, amount, merchant, categoryId, transferKind, dedupeKey, direction('out'|'in') }
// 출금(out)은 지출/이체 선택까지 학습하고, 입금(in)은 수입 분류만 학습한다
// (같은 이름이 출금과 입금에 모두 나올 수 있어 기록 종류까지 섞어 외우지 않기 위함).
export async function saveSmsItems(db, entries) {
  const ids = [];
  const records = [];
  for (const e of entries) {
    const record = await addTransaction(db, {
      type: e.type,
      date: e.date,
      time: e.time || '',
      amount: e.amount,
      categoryId: e.type === 'transfer' ? '' : e.categoryId,
      merchant: e.merchant,
      payMethod: 'account',
      source: 'sms_paste',
      dedupeKey: e.dedupeKey,
      transferKind: e.type === 'transfer' ? (e.transferKind || 'etc') : undefined,
    });
    ids.push(record.id);
    records.push(record);

    if (e.direction === 'out') {
      await learnMerchant(db, e.merchant, e.type === 'transfer'
        ? { learnedType: 'transfer', learnedTransferKind: e.transferKind || 'etc' }
        : { categoryId: e.categoryId, learnedType: 'expense' });
    } else if (e.type === 'income') {
      await learnMerchant(db, e.merchant, { categoryId: e.categoryId });
    }
  }
  return { ids, records };
}

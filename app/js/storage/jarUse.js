/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 저금통 목표 달성과 "썼어요" (화면흐름 v1.3 S9 5번, 데이터구조 3-1 isJoy·jarId, 3-8 jarEntries 'used')
// 모은 돈을 쓰면 ① 쓴 돈 기록(응원 소비: 절약 경고와 평소 기준선에서 제외)과 ② 칸의 'used' 기록을 함께 남긴다.
// 모은 돈을 모두 쓰면 칸을 마무리(status 'done')해서 칸 자리를 다시 쓸 수 있게 한다.
import { dbPut, newId } from './db.js';
import { addTransaction, softDeleteTransaction } from './transactions.js';
import { getJar, listEntries, sumEntries, softDeleteEntry } from './jars.js';

function fail(message) {
  const e = new Error(message);
  e.userMessage = message;
  return e;
}

// 목표 달성: 실제로 옮긴 돈(옮긴 돈 - 쓴 돈)이 목표 금액 이상. 계산된 아낀 돈만으로는 달성이 아니다 (R06).
export function isAchieved(jar, sums) {
  return jar.targetAmount > 0 && sums.balance >= jar.targetAmount;
}

export async function useJar(db, { jarId, categoryId, amount, date }) {
  const jar = await getJar(db, jarId);
  if (!jar) throw fail('저금통 칸을 찾지 못했어요.');
  if (jar.deletedAt) throw fail('저금통 칸을 찾지 못했어요.');
  if (jar.status === 'done') throw fail('이미 마무리한 칸이에요.');
  if (!Number.isInteger(amount) || amount < 1) throw fail('금액을 1원 이상으로 입력해 주세요.');
  const sums = sumEntries(await listEntries(db, jarId));
  if (amount > sums.balance) throw fail('칸에 모은 돈보다 많아요. 금액을 다시 확인해 주세요.');

  // 쓴 돈 기록 (분류가 없으면 여기서 오류가 나고 아무것도 남지 않는다)
  const transaction = await addTransaction(db, {
    type: 'expense', amount, date, categoryId,
    isJoy: true, jarId, source: 'manual',
    memo: jar.name + ' 칸에서 쓴 돈',
  });
  const entry = {
    id: newId(),
    jarId,
    date,
    kind: 'used',
    amount,
    transactionId: transaction.id,
    memo: '쓴 돈 기록과 함께 남김',
    createdAt: Date.now(),
  };
  await dbPut(db, 'jarEntries', entry);

  const jarDone = amount === sums.balance;     // 모은 돈을 모두 썼으면 칸을 마무리한다
  if (jarDone) { const now = Date.now(); await dbPut(db, 'jars', { ...jar, status: 'done', doneAt: now, updatedAt: now }); }
  return { transaction, entry, jarDone, previousStatus: jar.status };
}

// 방금 한 "썼어요"를 되돌린다 (U8): 쓴 돈 기록과 칸 기록을 삭제 표시하고, 마무리했던 칸은 다시 연다.
export async function undoUse(db, result) {
  await softDeleteTransaction(db, result.transaction.id);
  await softDeleteEntry(db, result.entry.id);
  if (result.jarDone) {
    const jar = await getJar(db, result.entry.jarId);
    if (jar) {
      const next = { ...jar, status: result.previousStatus || 'active', updatedAt: Date.now() };
      delete next.doneAt;
      await dbPut(db, 'jars', next);
    }
  }
}

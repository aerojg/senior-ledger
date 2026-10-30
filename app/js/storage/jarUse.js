/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 저금통 목표 달성과 "썼어요" (화면흐름 v1.3 S9 5번, 데이터구조 3-1 isJoy·jarId, 3-8 jarEntries 'used')
// 모은 돈을 쓰면 ① 쓴 돈 기록(응원 소비: 절약 경고와 평소 기준선에서 제외)과 ② 칸의 'used' 기록을 함께 남긴다.
// 모은 돈을 모두 쓰면 칸을 마무리(status 'done')해서 칸 자리를 다시 쓸 수 있게 한다.
import { dbGet, dbGetAll, dbPut, newId } from './db.js';
import { addTransaction, softDeleteTransaction, restoreTransaction } from './transactions.js';
import { getJar, listEntries, sumEntries, softDeleteEntry, restoreEntry } from './jars.js';

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

// ---- 쓴 돈 기록과 칸의 '사용한 돈' 기록을 함께 다룬다 (내역·저금통 화면에서 한쪽만 지우거나 되돌려 어긋나는 것을 막는다) ----

// 쓴 돈 기록(transactionId)에 연결된 칸의 사용 기록. live=true면 지우지 않은 것, false면 지운 것 중 가장 최근 것.
export async function findUsedEntry(db, transactionId, live = true) {
  const all = (await dbGetAll(db, 'jarEntries')).filter((e) => e.kind === 'used' && e.transactionId === transactionId);
  if (live) return all.find((e) => !e.deletedAt) || null;
  return all.filter((e) => e.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt)[0] || null;
}

async function balanceOf(db, jarId) {
  return sumEntries(await listEntries(db, jarId)).balance;
}

// 마무리했던 칸에 돈이 다시 생기면 칸을 다시 연다
async function reopenIfNeeded(db, jarId) {
  const jar = await getJar(db, jarId);
  if (!jar || jar.deletedAt || jar.status !== 'done') return;
  if ((await balanceOf(db, jarId)) > 0) {
    const next = { ...jar, status: 'active', updatedAt: Date.now() };
    delete next.doneAt;
    await dbPut(db, 'jars', next);
  }
}

// 사용 기록을 되살려 모은 돈이 0원이 되면 칸을 마무리한다 (처음 쓸 때와 같은 규칙)
async function finishIfEmpty(db, jarId) {
  const jar = await getJar(db, jarId);
  if (!jar || jar.deletedAt || jar.status === 'done') return;
  if ((await balanceOf(db, jarId)) === 0) {
    const now = Date.now();
    await dbPut(db, 'jars', { ...jar, status: 'done', doneAt: now, updatedAt: now });
  }
}

// 내역에서 쓴 돈 기록을 지울 때: 연결된 칸의 사용 기록도 함께 지운다
export async function softDeleteWithJar(db, transactionId) {
  const entry = await findUsedEntry(db, transactionId, true);
  const tx = await softDeleteTransaction(db, transactionId);
  if (entry) {
    await softDeleteEntry(db, entry.id);
    await reopenIfNeeded(db, entry.jarId);
  }
  return tx;
}

// 내역에서 [되돌리기]: 연결된 칸의 사용 기록도 함께 되살린다. 그 사이 칸의 돈이 모자라졌으면 아무것도 바꾸지 않고 알린다.
export async function restoreWithJar(db, transactionId) {
  const entry = await findUsedEntry(db, transactionId, false);
  if (entry) {
    const jar = await getJar(db, entry.jarId);
    if (!jar || jar.deletedAt) throw fail('저금통 칸이 없어져서 되돌릴 수 없어요.');
    if ((await balanceOf(db, entry.jarId)) < entry.amount) throw fail('칸에 모은 돈이 모자라서 되돌릴 수 없어요.');
  }
  const tx = await restoreTransaction(db, transactionId);
  if (entry) {
    await restoreEntry(db, entry.id);
    await finishIfEmpty(db, entry.jarId);
  }
  return tx;
}

// 저금통 화면에서 칸의 기록을 지울 때: 사용 기록이면 연결된 쓴 돈 기록도 함께 지운다
export async function deleteEntryWithTx(db, entry) {
  await softDeleteEntry(db, entry.id);
  if (entry.kind === 'used' && entry.transactionId) {
    const tx = await dbGet(db, 'transactions', entry.transactionId);
    if (tx && !tx.deletedAt) await softDeleteTransaction(db, entry.transactionId);
    await reopenIfNeeded(db, entry.jarId);
  }
}

// 저금통 화면에서 [되돌리기]: 사용 기록이면 연결된 쓴 돈 기록도 함께 되살린다
export async function restoreEntryWithTx(db, entryId) {
  const entry = await dbGet(db, 'jarEntries', entryId);
  if (!entry) throw fail('기록을 찾지 못했어요.');
  if (entry.kind === 'used') {
    if ((await balanceOf(db, entry.jarId)) < entry.amount) throw fail('칸에 모은 돈이 모자라서 되돌릴 수 없어요.');
  }
  const next = await restoreEntry(db, entryId);
  if (entry.kind === 'used' && entry.transactionId) {
    const tx = await dbGet(db, 'transactions', entry.transactionId);
    if (tx && tx.deletedAt) await restoreTransaction(db, entry.transactionId);
    await finishIfEmpty(db, entry.jarId);
  }
  return next;
}

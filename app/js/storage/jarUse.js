/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 저금통 목표 달성과 "썼어요" (화면흐름 v1.7 S9, 데이터구조 v1.7 3-1·3-8)
// 미리 모으는 칸에서 쓰면 ① 쓴 돈 기록(fromReserve: 월 쓴 돈 합계에 넣지 않는다. 적립 때 이미 지출로 잡았다)과 ② 칸의 'used' 기록을 함께 남긴다 (D113).
// 칸에 모은 돈보다 많이 쓰면 '먼저 쓴 돈'(칸 잔액이 마이너스)으로 허용한다. 올해 안에서만, 연말 결산에서 정리한다 (D114).
// 남은 돈 모음에서 쓰면 보통 쓴 돈으로 기록하고 모은 돈보다 많이는 쓸 수 없다.
// 칸은 목표만큼 모은 적이 있고 모은 돈을 모두 쓴 때에만 마무리(status 'done')한다.
import { dbGet, dbGetAll, dbPut, newId } from './db.js';
import { addTransaction, softDeleteTransaction, restoreTransaction } from './transactions.js';
import { todayStr } from './dates.js';
import { getJar, listEntries, sumEntries, softDeleteEntry, restoreEntry, isSurplus } from './jars.js';

function fail(message) {
  const e = new Error(message);
  e.userMessage = message;
  return e;
}

// 목표 달성: 실제로 저금한 돈(저금한 돈 - 쓴 돈)이 목표 금액 이상. 계산된 아낀 돈만으로는 달성이 아니다 (R06).
export function isAchieved(jar, sums) {
  return jar.targetAmount > 0 && sums.balance >= jar.targetAmount;
}

// 칸을 마무리해도 되는지: 목표만큼 저금한 적이 있고, 모은 돈을 모두 썼을 때 (남은 돈 모음은 마무리하지 않는다)
function shouldFinish(jar, sums) {
  return !isSurplus(jar) && jar.targetAmount > 0 && sums.moved >= jar.targetAmount && sums.balance === 0;
}

// advance: true면 칸에 모은 돈보다 많이 써서 '먼저 쓴 돈'으로 둔다 (미리 모으는 칸, 올해 안에서만)
export async function useJar(db, { jarId, categoryId, amount, date, advance = false, onPurpose = true }) {
  const jar = await getJar(db, jarId);
  if (!jar) throw fail('저금통 칸을 찾지 못했어요.');
  if (jar.deletedAt) throw fail('저금통 칸을 찾지 못했어요.');
  if (jar.status === 'done') throw fail('이미 마무리한 칸이에요.');
  if (!Number.isInteger(amount) || amount < 1) throw fail('금액을 1원 이상으로 입력해 주세요.');
  const sums = sumEntries(await listEntries(db, jarId));
  const surplus = isSurplus(jar);
  if (amount > sums.balance) {
    if (surplus || !advance) throw fail('칸에 모은 돈보다 많아요. 금액을 다시 확인해 주세요.');
    if (String(date).slice(0, 4) !== todayStr().slice(0, 4)) throw fail('먼저 쓴 돈은 올해 안에서만 쓸 수 있어요.');
  }

  // 쓴 돈 기록 (분류가 없으면 여기서 오류가 나고 아무것도 남지 않는다)
  const transaction = await addTransaction(db, {
    type: 'expense', amount, date, categoryId,
    isJoy: !surplus && onPurpose, fromReserve: !surplus, jarId, source: 'manual',   // 남은 돈 모음은 정한 용도가 없어 보통 쓴 돈으로 남긴다
    offPurpose: !surplus && !onPurpose,   // 용도 밖: 홈에는 '용도 밖' 이름표만 붙고, 합계 처리는 같다 (적립 때 이미 지출로 잡았다) (D115)
    memo: jar.name + (surplus ? '에서 쓴 돈' : ' 칸에서 쓴 돈'),
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
  if (!surplus && !onPurpose) entry.onPurpose = false;   // 없으면 용도대로 쓴 것으로 본다 (옛 기록 포함)
  await dbPut(db, 'jarEntries', entry);

  const jarDone = shouldFinish(jar, { moved: sums.moved, balance: sums.balance - amount });
  if (jarDone) { const now = Date.now(); await dbPut(db, 'jars', { ...jar, status: 'done', doneAt: now, updatedAt: now }); }
  return { transaction, entry, jarDone, previousStatus: jar.status };
}

// 칸에 모은 돈이 모자랄 때 모자란 만큼은 보통 지출로 적는다: 모은 돈만큼은 칸에서 쓰고, 나머지는 홈에 보통 쓴 돈으로 남긴다.
// 칸에 모은 돈이 없으면 보통 쓴 돈 하나만 남긴다(entry 없음).
export async function useJarSplit(db, { jarId, categoryId, amount, date, onPurpose = true }) {
  const jar = await getJar(db, jarId);
  if (!jar || jar.deletedAt) throw fail('저금통 칸을 찾지 못했어요.');
  const balance = sumEntries(await listEntries(db, jarId)).balance;
  const part = Math.max(0, Math.min(amount, balance));
  let result = null;
  if (part >= 1) result = await useJar(db, { jarId, categoryId, amount: part, date, onPurpose });
  const rest = amount - part;
  let extra = null;
  if (rest >= 1) {
    try {
      extra = await addTransaction(db, {
        type: 'expense', amount: rest, date, categoryId, isJoy: false, source: 'manual',
        memo: '칸에 모은 돈이 모자라 보통 지출로 적었어요',
      });
    } catch (e) {
      if (result) await undoUse(db, result);   // 반쪽만 남지 않게 되돌린다
      throw e;
    }
  }
  if (result) return { ...result, extraTransaction: extra };
  return { transaction: extra, entry: null, jarDone: false, previousStatus: jar.status, extraTransaction: null };
}

// 방금 한 "썼어요"를 되돌린다 (U8): 쓴 돈 기록과 칸 기록을 삭제 표시하고, 마무리했던 칸은 다시 연다.
export async function undoUse(db, result) {
  await softDeleteTransaction(db, result.transaction.id);
  if (result.extraTransaction) await softDeleteTransaction(db, result.extraTransaction.id);
  if (result.entry) await softDeleteEntry(db, result.entry.id);
  if (!result.entry) return;
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

// 홈 기록(transactionId)에 연결된 칸의 기록: 쓴 돈이면 'used', 미리 모으는 칸에 저금한 돈이면 'moved'.
// live=true면 지우지 않은 것, false면 지운 것 중 가장 최근 것.
export async function findUsedEntry(db, transactionId, live = true) {
  const all = (await dbGetAll(db, 'jarEntries')).filter((e) => (e.kind === 'used' || e.kind === 'moved') && e.transactionId === transactionId);
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
  if (shouldFinish(jar, sumEntries(await listEntries(db, jarId)))) {
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
    // 쓴 돈은 모은 돈이 모자라면 되살릴 수 없다(남은 돈 모음). 미리 모으는 칸은 먼저 쓴 돈이 허용된다.
    if (entry.kind === 'used' && isSurplus(jar) && (await balanceOf(db, entry.jarId)) < entry.amount) throw fail('칸에 모은 돈이 모자라서 되돌릴 수 없어요.');
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
  if ((entry.kind === 'used' || entry.kind === 'moved') && entry.transactionId) {
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
    const jar = await getJar(db, entry.jarId);
    if (jar && isSurplus(jar) && (await balanceOf(db, entry.jarId)) < entry.amount) throw fail('칸에 모은 돈이 모자라서 되돌릴 수 없어요.');
  }
  const next = await restoreEntry(db, entryId);
  if ((entry.kind === 'used' || entry.kind === 'moved') && entry.transactionId) {
    const tx = await dbGet(db, 'transactions', entry.transactionId);
    if (tx && tx.deletedAt) await restoreTransaction(db, entry.transactionId);
    await finishIfEmpty(db, entry.jarId);
  }
  return next;
}

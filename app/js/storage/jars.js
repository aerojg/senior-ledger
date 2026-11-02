/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 저금통 칸과 "저금했어요" 기록 (데이터구조 v1.7 3-7, 3-8)
// 저금통은 가상이다. 앱이 실제 돈을 보관하지 않고, 사용자가 실제로 저금했다고 체크한 기록만 남긴다.
// 칸 종류(jar.kind): 'reserve'(미리 모으는 칸, 직접 만든다, 최대 3칸. kind가 없는 옛 칸도 이것이다) 'surplus'(남은 돈 모음, 앱이 하나만 자동으로 만든다, 칸 수에 세지 않는다) (D113)
// 기록 종류(jarEntry.kind): 'moved'(저금했어요) 'saved'(옛 약속 아낀 돈 기록, 이제 화면에 보이지 않는다) 'used'(썼어요)
// 칸을 지울 때는 삭제 표시(deletedAt)만 하고 기록은 남긴다 (P4, D92). 바뀐 시각은 updatedAt에 적어 기록 합치기가 따른다.

import { dbGet, dbGetAll, dbPut, newId } from './db.js';
import { isValidDateStr } from './dates.js';
import { addTransaction, softDeleteTransaction } from './transactions.js';

export const MAX_JARS = 3;                 // 미리 모으는 칸의 개수 (D33). 남은 돈 모음은 세지 않는다 (D113)
export const SURPLUS_ID = 'surplus-main';  // 남은 돈 모음 칸의 고정 번호 (기기가 달라도 같은 칸으로 합쳐진다)
export const RESERVE_CATEGORY_ID = 'c15';   // 시스템 분류 '미리 모으는 돈' (defaults.js)
export const SURPLUS_NAME = '남은 돈 모음';
export const SURPLUS_PURPOSE = '월 결산 뒤 남은 돈을 모아 두는 곳';
export const MAX_AMOUNT = 9999999999;
export const JAR_SUGGESTIONS = ['보험료·세금', '경조사', '가족 여행', '명절·선물', '병원·건강'];
export const PURPOSE_MAX = 30;             // 용도 한 줄의 길이 (D111)
// 제안 이름을 골랐을 때 용도 칸 아래에 보이는 예시 (칸에 미리 적어 넣지는 않는다)
export const PURPOSE_EXAMPLES = {
  '보험료·세금': '예: 12월에 한꺼번에 내는 자동차 보험료',
  '경조사': '예: 내년 봄 친척 결혼식과 조의금',
  '가족 여행': '예: 여름휴가 제주도 3박 4일 여행비',
  '명절·선물': '예: 추석 용돈과 손주 선물',
  '병원·건강': '예: 치과 치료와 건강검진 비용',
};
export const PURPOSE_DEFAULT_EXAMPLE = '예: 12월에 내는 자동차 보험료';

function fail(message) {
  const e = new Error(message);
  e.userMessage = message;
  return e;
}

function checkName(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) throw fail('칸 이름을 적어 주세요.');
  if (n.length > 20) throw fail('칸 이름은 20자 안으로 적어 주세요.');
  return n;
}

// 용도 한 줄: 없어도 된다. 비어 있으면 '없음'(undefined)으로 돌려준다.
function checkPurpose(purpose) {
  const p = String(purpose == null ? '' : purpose).trim();
  if (!p) return undefined;
  if (p.length > PURPOSE_MAX) throw fail('용도는 ' + PURPOSE_MAX + '자 안으로 적어 주세요.');
  return p;
}

function checkAmount(amount, what) {
  if (!Number.isInteger(amount) || amount < 1) throw fail(what + '을 1원 이상으로 입력해 주세요.');
  if (amount > MAX_AMOUNT) throw fail('금액이 너무 커요. 숫자를 다시 확인해 주세요.');
  return amount;
}

// 쓰는 칸: 마무리했거나 지운 칸이 아닌 것
export function isLiveJar(j) {
  return !!j && j.status !== 'done' && !j.deletedAt;
}

export function isSurplus(j) {
  return !!j && j.kind === 'surplus';
}

// 쓰는 칸을 화면 순서대로 돌려준다. 남은 돈 모음이 있으면 맨 앞에 온다 (마무리한 칸과 지운 칸은 뺀다)
export async function listJars(db) {
  const all = await dbGetAll(db, 'jars');
  return all.filter(isLiveJar).sort((a, b) => a.order - b.order);
}

// 미리 모으는 칸만 (칸 수 제한은 이것만 센다)
export async function listReserveJars(db) {
  return (await listJars(db)).filter((j) => !isSurplus(j));
}

// 남은 돈 모음 칸이 없으면 하나 만든다. 이미 있으면 그대로 둔다 (D113).
export async function ensureSurplusJar(db) {
  const old = await dbGet(db, 'jars', SURPLUS_ID);
  if (old) return old;
  const now = Date.now();
  const jar = {
    id: SURPLUS_ID, kind: 'surplus', name: SURPLUS_NAME, purpose: SURPLUS_PURPOSE,
    targetAmount: 0, icon: 'jar', order: 0, status: 'active', createdAt: now, updatedAt: now,
  };
  await dbPut(db, 'jars', jar);
  return jar;
}

// 칸 하나 (지운 칸도 돌려주므로 화면에서는 deletedAt을 확인한다)
export async function getJar(db, id) {
  return dbGet(db, 'jars', id);
}

export async function createJar(db, { name, targetAmount, purpose }) {
  const jars = await listReserveJars(db);
  if (jars.length >= MAX_JARS) throw fail('미리 모으는 칸은 ' + MAX_JARS + '개까지 만들 수 있어요.');
  const now = Date.now();
  const jar = {
    id: newId(),
    kind: 'reserve',
    name: checkName(name),
    targetAmount: checkAmount(targetAmount, '목표 금액'),
    icon: 'jar',
    // 가운데 칸을 지워도 순서가 겹치지 않게 "마지막 순서 + 1"로 한다
    order: jars.reduce((m, j) => Math.max(m, j.order || 0), 0) + 1,   // 남은 돈 모음(순서 0) 뒤에 온다
    status: 'active',
    createdAt: now,
  };
  const p = checkPurpose(purpose);
  if (p) jar.purpose = p;
  await dbPut(db, 'jars', jar);
  return jar;
}

// purpose를 넘기지 않으면(undefined) 용도는 그대로 두고, 빈 글자를 넘기면 용도를 지운다.
export async function updateJar(db, id, { name, targetAmount, purpose }) {
  const old = await dbGet(db, 'jars', id);
  if (!old || old.deletedAt) throw fail('저금통 칸을 찾지 못했어요.');
  if (isSurplus(old)) throw fail('남은 돈 모음 칸은 고칠 수 없어요.');
  const next = { ...old, name: checkName(name), targetAmount: checkAmount(targetAmount, '목표 금액'), updatedAt: Date.now() };
  if (purpose !== undefined) {
    const p = checkPurpose(purpose);
    if (p) next.purpose = p; else delete next.purpose;
  }
  await dbPut(db, 'jars', next);
  return next;
}

// 칸 지우기: 삭제 표시만 한다. 그 칸의 기록은 지우지 않고 보이지 않게만 된다.
export async function deleteJar(db, id) {
  const old = await dbGet(db, 'jars', id);
  if (!old || old.deletedAt) throw fail('저금통 칸을 찾지 못했어요.');
  if (isSurplus(old)) throw fail('남은 돈 모음 칸은 지울 수 없어요.');
  // 먼저 쓴 돈이 남은 칸을 지우면 그 돈이 어디에도 기록되지 않게 되므로, 먼저 채우게 한다 (D114)
  if (sumEntries(await listEntries(db, id)).balance < 0) throw fail('먼저 쓴 돈이 남아 있어서 지울 수 없어요. 저금해서 먼저 채워 주세요.');
  const now = Date.now();
  const next = { ...old, deletedAt: now, updatedAt: now };
  await dbPut(db, 'jars', next);
  return next;
}

// 지운 칸 되돌리기: 쓰는 칸이 이미 MAX_JARS개면 되돌릴 수 없다.
export async function restoreJar(db, id) {
  const old = await dbGet(db, 'jars', id);
  if (!old || !old.deletedAt) throw fail('되돌릴 칸을 찾지 못했어요.');
  const jars = await listReserveJars(db);
  if (jars.length >= MAX_JARS) throw fail('칸이 이미 ' + MAX_JARS + '개라서 되돌릴 수 없어요. 칸을 하나 마무리하거나 지운 뒤에 다시 해 주세요.');
  const next = { ...old, order: jars.reduce((m, j) => Math.max(m, j.order || 0), 0) + 1, updatedAt: Date.now() };
  delete next.deletedAt;
  await dbPut(db, 'jars', next);
  return next;
}

// "저금했어요" 기록 한 건을 남긴다.
// 미리 모으는 칸에 저금하면 홈에도 쓴 돈(분류 '미리 모으는 돈', 고정비)이 함께 기록되어 짝이 맞는다 (D113).
// 남은 돈 모음은 이미 결산에서 남은 돈이라 홈에는 아무것도 기록하지 않는다.
export async function addMoved(db, { jarId, amount, date, memo, dedupeKey }) {   // dedupeKey: 이체 문자에서 온 저금이면 같은 문자를 두 번 기록하지 않도록 남긴다 (SAVE-SMS)
  const jar = await dbGet(db, 'jars', jarId);
  if (!jar || jar.deletedAt) throw fail('저금통 칸을 찾지 못했어요.');
  checkAmount(amount, '저금한 금액');
  if (!isValidDateStr(date)) throw fail('날짜를 다시 확인해 주세요.');
  const m = String(memo == null ? '' : memo).trim();
  let tx = null;
  if (!isSurplus(jar)) {
    tx = await addTransaction(db, {
      type: 'expense', date, amount, categoryId: RESERVE_CATEGORY_ID,
      costType: 'fixed', essential: true, isJoy: false, payMethod: 'account',
      jarId, reserveDeposit: true, source: 'jar',
      dedupeKey: dedupeKey || undefined,
      memo: jar.name + ' 칸에 미리 모음' + (m ? ' · ' + m : ''),
    });
  }
  const entry = {
    id: newId(),
    jarId,
    date,
    kind: 'moved',
    amount,
    createdAt: Date.now(),
  };
  if (tx) entry.transactionId = tx.id;
  if (m) entry.memo = m;
  try {
    await dbPut(db, 'jarEntries', entry);
  } catch (e) {
    if (tx) { try { await softDeleteTransaction(db, tx.id); } catch (e2) { console.error(e2); } }
    throw e;
  }
  return entry;
}

// 한 칸의 기록을 최근 순서로 돌려준다. 삭제 표시된 것은 뺀다.
export async function listEntries(db, jarId) {
  const all = await dbGetAll(db, 'jarEntries');
  return all
    .filter((e) => e.jarId === jarId && !e.deletedAt)
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
}

// 같은 칸에 같은 날 같은 금액을 이미 저금했다고 적었는지 찾는다 (두 번 적는 실수를 막으려고 물어볼 때 쓴다, SAVE-DUP)
export async function findSameMoved(db, { jarId, amount, date }) {
  const list = await listEntries(db, jarId);
  return list.find((e) => e.kind === 'moved' && e.amount === amount && e.date === date) || null;
}

export async function softDeleteEntry(db, id) {
  const old = await dbGet(db, 'jarEntries', id);
  if (!old) throw fail('기록을 찾지 못했어요.');
  const next = { ...old, deletedAt: Date.now() };
  await dbPut(db, 'jarEntries', next);
  return next;
}

export async function restoreEntry(db, id) {
  const old = await dbGet(db, 'jarEntries', id);
  if (!old) throw fail('기록을 찾지 못했어요.');
  const next = { ...old };
  delete next.deletedAt;
  await dbPut(db, 'jarEntries', next);
  return next;
}

// 합계: 저금한 돈(moved) - 쓴 돈(used). 옛 약속 아낀 돈(saved)은 따로 더해 두기만 하고 화면에는 쓰지 않는다.
export function sumEntries(entries) {
  let moved = 0, used = 0, saved = 0;
  for (const e of entries) {
    if (e.deletedAt) continue;
    if (e.kind === 'moved') moved += e.amount;
    else if (e.kind === 'used') used += e.amount;
    else if (e.kind === 'saved') saved += e.amount;
  }
  return { moved, used, saved, balance: moved - used };
}

// 기간 안(시작일~끝일, 'YYYY-MM-DD' 포함)에 저금한 돈(moved)의 합계. 이달 저금액에 쓴다 (D112).
export function sumMovedIn(entries, startDate, endDate) {
  let sum = 0;
  for (const e of entries) {
    if (e.deletedAt || e.kind !== 'moved') continue;
    if (e.date >= startDate && e.date <= endDate) sum += e.amount;
  }
  return sum;
}

// 기간 안(시작일~끝일 포함)에 저금한 돈을 칸 종류별로 나눠 돌려준다. 지운 칸의 기록은 뺀다. 남은 돈 안내에 쓴다 (D113).
// 돌려주는 값: { reserve: 미리 모으는 칸에 저금한 돈 전체, reserveLegacy: 그중 홈 지출과 연결되지 않은 옛 기록, surplus: 남은 돈 모음에 저금한 돈 }
export async function movedByKind(db, startDate, endDate) {
  const jarsAll = await dbGetAll(db, 'jars');
  const kindOf = new Map(jarsAll.filter((j) => !j.deletedAt).map((j) => [j.id, isSurplus(j) ? 'surplus' : 'reserve']));
  const entries = await dbGetAll(db, 'jarEntries');
  const out = { reserve: 0, reserveLegacy: 0, surplus: 0 };
  for (const e of entries) {
    if (e.deletedAt || e.kind !== 'moved' || !kindOf.has(e.jarId)) continue;
    if (e.date < startDate || e.date > endDate) continue;
    const k = kindOf.get(e.jarId);
    out[k] += e.amount;
    if (k === 'reserve' && !e.transactionId) out.reserveLegacy += e.amount;
  }
  return out;
}

// 기간 안에 미리 모으는 칸에 저금한 돈을 칸별로 나눠 돌려준다. 마무리한 칸도 넣고(done 표시), 지운 칸은 뺀다.
// 결산의 "이 달 저금통" 카드가 저금통 화면에서 안 보이는 마무리한 칸의 돈까지 합한 것을 칸별로 보여 줄 때 쓴다 (MOVED-BY-JAR).
// 돌려주는 값: [{ jarId, name, done, amount }] 금액이 큰 순서
export async function movedByJar(db, startDate, endDate) {
  const jarsAll = (await dbGetAll(db, 'jars')).filter((j) => !j.deletedAt && !isSurplus(j));
  const byId = new Map(jarsAll.map((j) => [j.id, { jarId: j.id, name: j.name, done: j.status === 'done', amount: 0 }]));
  const entries = await dbGetAll(db, 'jarEntries');
  for (const e of entries) {
    if (e.deletedAt || e.kind !== 'moved' || !byId.has(e.jarId)) continue;
    if (e.date < startDate || e.date > endDate) continue;
    byId.get(e.jarId).amount += e.amount;
  }
  return [...byId.values()].filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
}

// 채움 비율(0~100 정수). 목표를 넘으면 100에서 멈춘다.
export function fillPercent(balance, target) {
  if (!(target > 0) || !(balance > 0)) return 0;
  return Math.min(100, Math.floor((balance / target) * 100));
}

/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 저금통 칸과 "옮겼어요" 기록 (데이터구조 v1.2 3-7, 3-8)
// 저금통은 가상이다. 앱이 실제 돈을 보관하지 않고, 사용자가 실제로 옮겼다고 체크한 기록만 남긴다.
// kind: 'moved'(옮겼어요) 'saved'(약속에서 아낀 돈, 계산) 'used'(썼어요)
// 칸을 지울 때는 삭제 표시(deletedAt)만 하고 기록은 남긴다 (P4, D92). 바뀐 시각은 updatedAt에 적어 기록 합치기가 따른다.

import { dbGet, dbGetAll, dbPut, newId } from './db.js';
import { isValidDateStr } from './dates.js';

export const MAX_JARS = 3;                 // 4단계 구간 1에서 1칸에서 3칸으로 늘렸다 (D33)
export const MAX_AMOUNT = 9999999999;
export const JAR_SUGGESTIONS = ['가족 선물·용돈', '부부 여행', '병원·건강', '경조사', '비상금'];

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

function checkAmount(amount, what) {
  if (!Number.isInteger(amount) || amount < 1) throw fail(what + '을 1원 이상으로 입력해 주세요.');
  if (amount > MAX_AMOUNT) throw fail('금액이 너무 커요. 숫자를 다시 확인해 주세요.');
  return amount;
}

// 쓰는 칸: 마무리했거나 지운 칸이 아닌 것
export function isLiveJar(j) {
  return !!j && j.status !== 'done' && !j.deletedAt;
}

// 모으는 중이거나 쉬는 칸을 화면 순서대로 돌려준다 (마무리한 칸과 지운 칸은 뺀다)
export async function listJars(db) {
  const all = await dbGetAll(db, 'jars');
  return all.filter(isLiveJar).sort((a, b) => a.order - b.order);
}

// 칸 하나 (지운 칸도 돌려주므로 화면에서는 deletedAt을 확인한다)
export async function getJar(db, id) {
  return dbGet(db, 'jars', id);
}

export async function createJar(db, { name, targetAmount }) {
  const jars = await listJars(db);
  if (jars.length >= MAX_JARS) throw fail('지금은 저금통 칸을 ' + MAX_JARS + '개까지 만들 수 있어요.');
  const now = Date.now();
  const jar = {
    id: newId(),
    name: checkName(name),
    targetAmount: checkAmount(targetAmount, '목표 금액'),
    icon: 'jar',
    // 가운데 칸을 지워도 순서가 겹치지 않게 "마지막 순서 + 1"로 한다
    order: jars.reduce((m, j) => Math.max(m, j.order || 0), 0) + 1,
    status: 'active',
    createdAt: now,
  };
  await dbPut(db, 'jars', jar);
  return jar;
}

export async function updateJar(db, id, { name, targetAmount }) {
  const old = await dbGet(db, 'jars', id);
  if (!old || old.deletedAt) throw fail('저금통 칸을 찾지 못했어요.');
  const next = { ...old, name: checkName(name), targetAmount: checkAmount(targetAmount, '목표 금액'), updatedAt: Date.now() };
  await dbPut(db, 'jars', next);
  return next;
}

// 칸 지우기: 삭제 표시만 한다. 그 칸의 기록은 지우지 않고 보이지 않게만 된다.
export async function deleteJar(db, id) {
  const old = await dbGet(db, 'jars', id);
  if (!old || old.deletedAt) throw fail('저금통 칸을 찾지 못했어요.');
  const now = Date.now();
  const next = { ...old, deletedAt: now, updatedAt: now };
  await dbPut(db, 'jars', next);
  return next;
}

// 지운 칸 되돌리기: 쓰는 칸이 이미 MAX_JARS개면 되돌릴 수 없다.
export async function restoreJar(db, id) {
  const old = await dbGet(db, 'jars', id);
  if (!old || !old.deletedAt) throw fail('되돌릴 칸을 찾지 못했어요.');
  const jars = await listJars(db);
  if (jars.length >= MAX_JARS) throw fail('칸이 이미 ' + MAX_JARS + '개라서 되돌릴 수 없어요. 칸을 하나 마무리하거나 지운 뒤에 다시 해 주세요.');
  const next = { ...old, order: jars.reduce((m, j) => Math.max(m, j.order || 0), 0) + 1, updatedAt: Date.now() };
  delete next.deletedAt;
  await dbPut(db, 'jars', next);
  return next;
}

// "옮겼어요" 기록 한 건을 남긴다. 이체 기록은 만들지 않는다(저금통 기록만 남김, 2026-10-25 결정).
export async function addMoved(db, { jarId, amount, date, memo }) {
  const jar = await dbGet(db, 'jars', jarId);
  if (!jar || jar.deletedAt) throw fail('저금통 칸을 찾지 못했어요.');
  checkAmount(amount, '옮긴 금액');
  if (!isValidDateStr(date)) throw fail('날짜를 다시 확인해 주세요.');
  const entry = {
    id: newId(),
    jarId,
    date,
    kind: 'moved',
    amount,
    createdAt: Date.now(),
  };
  const m = String(memo == null ? '' : memo).trim();
  if (m) entry.memo = m;
  await dbPut(db, 'jarEntries', entry);
  return entry;
}

// 한 칸의 기록을 최근 순서로 돌려준다. 삭제 표시된 것은 뺀다.
export async function listEntries(db, jarId) {
  const all = await dbGetAll(db, 'jarEntries');
  return all
    .filter((e) => e.jarId === jarId && !e.deletedAt)
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
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

// 합계: 옮긴 돈(moved) - 사용한 돈(used). 계산된 아낀 돈(saved)은 따로 더해 둔다.
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

// 채움 비율(0~100 정수). 목표를 넘으면 100에서 멈춘다.
export function fillPercent(balance, target) {
  if (!(target > 0) || !(balance > 0)) return 0;
  return Math.min(100, Math.floor((balance / target) * 100));
}

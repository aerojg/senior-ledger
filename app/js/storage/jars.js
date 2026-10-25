// 저금통 칸과 "옮겼어요" 기록 (데이터구조 v1.2 3-7, 3-8)
// 저금통은 가상이다. 앱이 실제 돈을 보관하지 않고, 사용자가 실제로 옮겼다고 체크한 기록만 남긴다.
// 2단계에서는 칸 1개와 kind 'moved'(옮겼어요)만 쓴다. 'saved'(계산된 아낀 돈)는 4단계에서 연결한다.

import { dbGet, dbGetAll, dbPut, newId } from './db.js';
import { isValidDateStr } from './dates.js';

export const MAX_JARS = 1;                 // 2단계는 1칸, 4단계에서 3칸으로 늘린다 (D33)
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

// 모으는 중이거나 쉬는 칸을 화면 순서대로 돌려준다
export async function listJars(db) {
  const all = await dbGetAll(db, 'jars');
  return all.filter((j) => j.status !== 'done').sort((a, b) => a.order - b.order);
}

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
    order: jars.length + 1,
    status: 'active',
    createdAt: now,
  };
  await dbPut(db, 'jars', jar);
  return jar;
}

export async function updateJar(db, id, { name, targetAmount }) {
  const old = await dbGet(db, 'jars', id);
  if (!old) throw fail('저금통 칸을 찾지 못했어요.');
  const next = { ...old, name: checkName(name), targetAmount: checkAmount(targetAmount, '목표 금액') };
  await dbPut(db, 'jars', next);
  return next;
}

// "옮겼어요" 기록 한 건을 남긴다. 이체 기록은 만들지 않는다(저금통 기록만 남김, 2026-10-25 결정).
export async function addMoved(db, { jarId, amount, date, memo }) {
  const jar = await dbGet(db, 'jars', jarId);
  if (!jar) throw fail('저금통 칸을 찾지 못했어요.');
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

// 합계: 옮긴 돈(moved) - 사용한 돈(used). 계산된 아낀 돈(saved)은 따로 더해 두고 4단계에서 보인다.
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

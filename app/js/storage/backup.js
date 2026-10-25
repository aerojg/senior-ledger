// 백업 파일 만들기·읽기·불러오기 (데이터구조_시니어가계부.md v1.2 4번, 화면흐름 S12, D45, D61)
// 기록은 휴대폰 안에만 있으므로 백업 파일이 안전장치의 전부다(R01).
// 불러오기는 두 가지다: 바꾸기(지금 기록을 파일의 기록으로 교체)와 합치기(지금 기록은 두고 파일에만 있는 것을 더함).
// 둘 다 시작 전에 지금 기록 전체를 tempBackups에 임시로 보관하고, 모든 쓰기는 한 번의 저장 작업(transaction)으로 한다.
// 중간에 실패하면 아무것도 바뀌지 않는다.

import { SCHEMA_VERSION, dbGet, dbPut, dbDelete, syncDefaultCategories } from './db.js';
import { makeDefaultSettings } from './defaults.js';
import { isValidDateStr, toDateStr } from './dates.js';
import { MAX_JARS } from './jars.js';

export const BACKUP_FORMAT = 'gagyebuja-backup';
export const APP_VERSION = '0.1.0';
export const TEMP_KEY = 'import-undo';
export const TEMP_DAYS = 7;          // 되돌리기용 임시 보관 기간
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

const DAY = 24 * 60 * 60 * 1000;

// 백업 파일에 들어가는 기록 저장소. phraseSeen, tempBackups는 넣지 않는다(데이터구조 4번).
const ARRAY_STORES = ['transactions', 'categories', 'merchants', 'pledges', 'pledgeResults', 'jars', 'jarEntries', 'restCardUses', 'badges', 'reviews'];
const REQUIRED_STORES = ['transactions', 'categories', 'jars', 'jarEntries'];
// 같은 번호(id)로 비교해 합치는 저장소 (jars, jarEntries, transactions는 아래에서 따로 처리)
const PLAIN_ID_STORES = ['pledges', 'pledgeResults', 'restCardUses', 'badges', 'reviews'];

function fail(message) {
  const e = new Error(message);
  e.userMessage = message;
  return e;
}

// ---- 읽기·쓰기 도구 ----
function readAllStores(db, names) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names);
    const out = {};
    for (const n of names) {
      const r = tx.objectStore(n).getAll();
      r.onsuccess = () => { out[n] = r.result; };
    }
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function runWrite(db, names, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    try { fn(tx); } catch (e) { try { tx.abort(); } catch (e2) { /* 이미 끝남 */ } reject(e); return; }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('저장이 취소됐어요.'));
  });
}

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
const countLive = (arr) => (arr || []).filter((r) => !r.deletedAt).length;
// 기록이 마지막으로 바뀐 때: 고친 때, 만든 때, 삭제 표시한 때 중 가장 늦은 것
// (저금통 기록은 updatedAt이 없어서 deletedAt까지 함께 본다. 삭제했다 되살린 기록은 표시가 지워져 옛것으로 보일 수 있다.)
const stamp = (r) => Math.max(r.updatedAt || 0, r.createdAt || 0, r.deletedAt || 0);

function localIso(d) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' +
    p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + sign + p(Math.floor(a / 60)) + ':' + p(a % 60);
}

export function backupFileName(now = new Date()) {
  return 'gagyebuja-backup-' + toDateStr(now) + '.json';
}

// ---- 백업 파일 만들기 ----
export async function buildBackup(db, now = new Date()) {
  const all = await readAllStores(db, [...ARRAY_STORES, 'settings', 'meta']);
  const meta = {};
  for (const m of all.meta) meta[m.key] = m.value;
  const data = {};
  for (const n of ARRAY_STORES) data[n] = all[n];
  data.balanceChecks = [];                       // 4단계에서 만들 자리(D40)
  data.settings = all.settings.find((s) => s.key === 'main') || {};
  data.meta = meta;
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: localIso(now), appVersion: APP_VERSION, data };
}

export function serializeBackup(backup) {
  return JSON.stringify(backup);
}

// ---- 파일 검사: 아무것도 바꾸지 않고 읽을 수 있는 파일인지만 본다 ----
function recordOk(store, r) {
  if (!isPlain(r)) return false;
  const key = store === 'merchants' ? r.normalizedName : r.id;
  if (typeof key !== 'string' || !key) return false;
  const amountOk = Number.isInteger(r.amount) && r.amount > 0;
  if (store === 'transactions') return ['expense', 'income', 'transfer'].includes(r.type) && isValidDateStr(r.date) && amountOk;
  if (store === 'jarEntries') return typeof r.jarId === 'string' && ['saved', 'moved', 'used'].includes(r.kind) && isValidDateStr(r.date) && amountOk;
  if (store === 'jars') return typeof r.name === 'string' && Number.isInteger(r.targetAmount) && r.targetAmount > 0;
  if (store === 'categories') return typeof r.name === 'string' && (r.kind === 'expense' || r.kind === 'income');
  return true;
}

// 돌려주는 값: { ok: true, backup, info } 또는 { ok: false, reason: 'broken' | 'newer' }
// 이 앱의 백업이 아닌 파일과 깨진 파일은 둘 다 'broken'이다(같은 안내를 보인다).
export function inspectBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return { ok: false, reason: 'broken' }; }
  if (!isPlain(obj) || obj.format !== BACKUP_FORMAT) return { ok: false, reason: 'broken' };
  const sv = obj.schemaVersion;
  if (!Number.isInteger(sv) || sv < 1) return { ok: false, reason: 'broken' };
  if (sv > SCHEMA_VERSION) return { ok: false, reason: 'newer' };
  const d = obj.data;
  if (!isPlain(d)) return { ok: false, reason: 'broken' };
  for (const n of ARRAY_STORES) {
    if (d[n] === undefined) {
      if (REQUIRED_STORES.includes(n)) return { ok: false, reason: 'broken' };
      continue;
    }
    if (!Array.isArray(d[n])) return { ok: false, reason: 'broken' };
    for (const r of d[n]) if (!recordOk(n, r)) return { ok: false, reason: 'broken' };
  }
  if (d.settings !== undefined && !isPlain(d.settings)) return { ok: false, reason: 'broken' };
  return {
    ok: true,
    backup: obj,
    info: {
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
      schemaVersion: sv,
      recordCount: countLive(d.transactions),
      jarEntryCount: countLive(d.jarEntries),
    },
  };
}

// 지금 기록의 개수(삭제 표시한 것은 뺌)
export async function countCurrent(db) {
  const all = await readAllStores(db, ['transactions', 'jarEntries']);
  return { recordCount: countLive(all.transactions), jarEntryCount: countLive(all.jarEntries) };
}

// ---- 합치기 계산 (데이터구조 4번) ----
// local: 지금 기록 { 저장소이름: [기록] }, fileData: 파일의 data
// 돌려주는 값: 쓸 기록 put, 그리고 화면에 보일 숫자들
export function planMerge(local, fileData) {
  const put = {};
  const add = (store, rec) => { (put[store] = put[store] || []).push(rec); };
  const out = { put, addedRecords: 0, updatedRecords: 0, skippedDuplicates: 0, addedJarEntries: 0, skippedJarNames: [] };
  const fileOf = (n) => (Array.isArray(fileData[n]) ? fileData[n] : []);
  const byId = (arr) => new Map((arr || []).map((r) => [r.id, r]));

  // 기록(transactions): 같은 번호는 늦게 바뀐 쪽, 한쪽에만 있으면 더한다.
  // 문자 해시(dedupeKey)가 지금 기록에 이미 있으면 같은 문자를 다른 앱에서 붙여 넣은 것으로 보고 더하지 않는다.
  const localTx = byId(local.transactions);
  const liveKeys = new Set();
  for (const t of local.transactions || []) if (!t.deletedAt && t.dedupeKey) liveKeys.add(t.dedupeKey);
  for (const f of fileOf('transactions')) {
    const l = localTx.get(f.id);
    if (!l) {
      if (!f.deletedAt && f.dedupeKey && liveKeys.has(f.dedupeKey)) { out.skippedDuplicates += 1; continue; }
      add('transactions', f);
      if (!f.deletedAt) out.addedRecords += 1;
    } else if (stamp(f) > stamp(l)) {
      add('transactions', f);
      out.updatedRecords += 1;
    }
  }

  // 저금통 칸(jars): 지금은 칸을 MAX_JARS개까지만 쓴다. 넘치는 칸은 더하지 않고, 그 칸의 기록도 더하지 않는다(화면에서 보이지 않게 되므로).
  const localJars = byId(local.jars);
  let activeJars = (local.jars || []).filter((j) => j.status !== 'done').length;
  const knownJarIds = new Set((local.jars || []).map((j) => j.id));
  for (const f of fileOf('jars')) {
    const l = localJars.get(f.id);
    if (!l) {
      if (f.status !== 'done' && activeJars >= MAX_JARS) { out.skippedJarNames.push(f.name); continue; }
      add('jars', f);
      knownJarIds.add(f.id);
      if (f.status !== 'done') activeJars += 1;
    } else if (stamp(f) > stamp(l)) {
      add('jars', f);
    }
  }
  const localEntries = byId(local.jarEntries);
  for (const f of fileOf('jarEntries')) {
    const l = localEntries.get(f.id);
    if (!l) {
      if (!knownJarIds.has(f.jarId)) continue;
      add('jarEntries', f);
      if (!f.deletedAt) out.addedJarEntries += 1;
    } else if (stamp(f) > stamp(l)) {
      add('jarEntries', f);
    }
  }

  // 나머지 번호 저장소(약속, 성적표, 쉬어가기, 배지, 결산 한마디)
  for (const n of PLAIN_ID_STORES) {
    const m = byId(local[n]);
    for (const f of fileOf(n)) {
      const l = m.get(f.id);
      if (!l || stamp(f) > stamp(l)) add(n, f);
    }
  }

  // 가맹점: 같은 이름이면 더 최근에 쓴 쪽
  const localMer = new Map((local.merchants || []).map((r) => [r.normalizedName, r]));
  for (const f of fileOf('merchants')) {
    const l = localMer.get(f.normalizedName);
    if (!l || (f.lastUsedAt || 0) > (l.lastUsedAt || 0)) add('merchants', f);
  }

  // 분류: 기본 분류는 지금 것을 유지하고, 사용자가 만든 분류 중 없는 것만 더한다
  const localCat = new Set((local.categories || []).map((c) => c.id));
  for (const f of fileOf('categories')) {
    if (f.isUserDefined && !localCat.has(f.id)) add('categories', f);
  }
  return out;
}

function summarize(plan) {
  const { put, ...rest } = plan;
  return rest;
}

// 화면의 확인 질문에 보일 숫자를 미리 계산한다(아무것도 쓰지 않는다)
export async function previewMerge(db, backup) {
  const local = await readAllStores(db, ARRAY_STORES);
  return summarize(planMerge(local, backup.data));
}

// ---- 불러오기 ----
function writeData(tx, data, settings) {
  for (const n of ARRAY_STORES) {
    const s = tx.objectStore(n);
    s.clear();
    for (const r of data[n] || []) s.put(r);
  }
  tx.objectStore('settings').put(settings);
}

const WRITE_STORES = [...ARRAY_STORES, 'settings', 'tempBackups'];

// 바꾸기: 지금 기록 전체를 파일의 기록으로 바꾼다. 앱 설정도 파일의 것을 쓴다. 앱 상태(meta)는 이 기기의 것을 유지한다.
export async function importReplace(db, backup) {
  const snapshot = await buildBackup(db);
  const fileSettings = isPlain(backup.data.settings) ? backup.data.settings : {};
  const settings = { ...makeDefaultSettings(), ...fileSettings, key: 'main' };
  await runWrite(db, WRITE_STORES, (tx) => {
    tx.objectStore('tempBackups').put({ key: TEMP_KEY, createdAt: Date.now(), payload: snapshot });
    writeData(tx, backup.data, settings);
  });
  await syncDefaultCategories(db);   // 파일에 기본 분류가 빠져 있어도 채워 둔다
  return { recordCount: countLive(backup.data.transactions) };
}

// 합치기: 지금 기록은 그대로 두고 파일에만 있는 기록을 더한다. 설정과 앱 상태는 지금 것을 유지한다.
export async function importMerge(db, backup) {
  const local = await readAllStores(db, ARRAY_STORES);
  const plan = planMerge(local, backup.data);
  const snapshot = await buildBackup(db);
  await runWrite(db, WRITE_STORES, (tx) => {
    tx.objectStore('tempBackups').put({ key: TEMP_KEY, createdAt: Date.now(), payload: snapshot });
    for (const [store, recs] of Object.entries(plan.put)) {
      const s = tx.objectStore(store);
      for (const r of recs) s.put(r);
    }
  });
  return summarize(plan);
}

// ---- 방금 가져오기 되돌리기 ----
export async function getUndoInfo(db, now = Date.now()) {
  const t = await dbGet(db, 'tempBackups', TEMP_KEY);
  if (!t) return null;
  if (now - t.createdAt > TEMP_DAYS * DAY) {      // 7일이 지나면 지운다
    await dbDelete(db, 'tempBackups', TEMP_KEY);
    return null;
  }
  return { createdAt: t.createdAt, recordCount: countLive(t.payload.data.transactions) };
}

export async function undoImport(db) {
  const t = await dbGet(db, 'tempBackups', TEMP_KEY);
  if (!t) throw fail('되돌릴 수 있는 불러오기가 없어요.');
  const d = t.payload.data;
  const settings = { ...makeDefaultSettings(), ...(isPlain(d.settings) ? d.settings : {}), key: 'main' };
  await runWrite(db, WRITE_STORES, (tx) => {
    writeData(tx, d, settings);
    tx.objectStore('tempBackups').delete(TEMP_KEY);
  });
  await syncDefaultCategories(db);
}

// ---- 마지막 백업일과 홈의 안내 줄 (D45, 화면흐름 S1 6번) ----
export async function markBackedUp(db, now = Date.now()) {
  await dbPut(db, 'meta', { key: 'lastBackupAt', value: now });
  await dbDelete(db, 'meta', 'backupReminderDismissedAt');
}

export async function getLastBackupAt(db) {
  const m = await dbGet(db, 'meta', 'lastBackupAt');
  return m ? m.value : null;
}

export async function dismissReminder(db, now = Date.now()) {
  await dbPut(db, 'meta', { key: 'backupReminderDismissedAt', value: now });
}

// 안내 줄을 보일지 정한다. 숫자(10건, 14일, 30건, 3일)는 제안값이며 시험으로 조정한다.
// 마지막 저장 뒤 새 기록이 하나도 없으면 날짜만 지났다고 안내하지 않는다(저장할 것이 없으므로).
export function decideReminder({ recordCount, newSinceBackup, lastBackupAt, dismissedAt, now }) {
  if (dismissedAt && now - dismissedAt < 3 * DAY) return null;
  if (!lastBackupAt) return recordCount >= 10 ? { reason: 'never', count: recordCount } : null;
  const days = Math.floor((now - lastBackupAt) / DAY);
  if (newSinceBackup >= 30) return { reason: 'new', count: newSinceBackup, days };
  if (days >= 14 && newSinceBackup > 0) return { reason: 'days', days, count: newSinceBackup };
  return null;
}

export async function computeReminder(db, now = Date.now()) {
  const all = await readAllStores(db, ['transactions', 'meta']);
  const meta = {};
  for (const m of all.meta) meta[m.key] = m.value;
  const live = all.transactions.filter((t) => !t.deletedAt);
  const lastBackupAt = meta.lastBackupAt || null;
  const newSinceBackup = lastBackupAt ? live.filter((t) => (t.createdAt || 0) > lastBackupAt).length : live.length;
  return decideReminder({ recordCount: live.length, newSinceBackup, lastBackupAt, dismissedAt: meta.backupReminderDismissedAt || null, now });
}

// 저장 계층의 바닥: IndexedDB 'gagyebuja-db' 열기와 기본 도구
// 기준 문서: 데이터구조_시니어가계부.md v1.0
// 저장소 14개를 만든다. 15번째 balanceChecks는 4단계 결정 뒤에 스키마 버전 2로 추가한다(D40).

import { DEFAULT_CATEGORIES, makeDefaultSettings } from './defaults.js';

export const DB_NAME = 'gagyebuja-db';
export const SCHEMA_VERSION = 1;

// 저장소 이름, 키, 찾기 색인
const STORES = [
  { name: 'transactions',  keyPath: 'id', indexes: ['date', 'categoryId', 'type', 'dedupeKey'] },
  { name: 'categories',    keyPath: 'id' },
  { name: 'merchants',     keyPath: 'normalizedName' },
  { name: 'pledges',       keyPath: 'id' },
  { name: 'pledgeResults', keyPath: 'id' },
  { name: 'jars',          keyPath: 'id' },
  { name: 'jarEntries',    keyPath: 'id' },
  { name: 'restCardUses',  keyPath: 'id' },
  { name: 'badges',        keyPath: 'id' },
  { name: 'reviews',       keyPath: 'id' },
  { name: 'settings',      keyPath: 'key' },
  { name: 'meta',          keyPath: 'key' },
  { name: 'phraseSeen',    keyPath: 'phraseId' },
  { name: 'tempBackups',   keyPath: 'key' },
];

export const STORE_NAMES = STORES.map((s) => s.name);

// 요청(request) 하나를 약속(Promise)으로 바꾼다
function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 데이터베이스를 열고, 처음이면 저장소를 만든다.
// name을 바꿔 부르면 시험용 데이터베이스를 따로 쓸 수 있다.
export function openDb(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, SCHEMA_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // 버전을 올리는 방향의 변환만 둔다(P6). 지금은 버전 1(처음 만들기)뿐이다.
      if (event.oldVersion < 1) {
        for (const s of STORES) {
          const store = db.createObjectStore(s.name, { keyPath: s.keyPath });
          for (const idx of s.indexes || []) {
            store.createIndex(idx, idx, { unique: false });
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('다른 창에서 앱이 열려 있어요. 다른 창을 닫고 다시 열어 주세요.'));
  });
}

// 처음 한 번만 기본값(분류, 설정, 앱 상태)을 넣는다. 여러 번 불러도 안전하다.
export async function seedIfEmpty(db) {
  const now = Date.now();
  const tx = db.transaction(['categories', 'settings', 'meta'], 'readwrite');
  const categories = tx.objectStore('categories');
  const settings = tx.objectStore('settings');
  const meta = tx.objectStore('meta');

  if ((await reqToPromise(categories.count())) === 0) {
    for (const c of DEFAULT_CATEGORIES) categories.put(c);
  }
  if (!(await reqToPromise(settings.get('main')))) {
    settings.put(makeDefaultSettings());
  }
  if (!(await reqToPromise(meta.get('schemaVersion')))) {
    meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
    meta.put({ key: 'createdAt', value: now });
  }
  meta.put({ key: 'lastOpenedAt', value: now });

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// 기본 분류가 새 버전에서 늘거나 이름이 바뀌었을 때 이미 쓰고 있는 기록 저장소에도 맞춘다.
// 없는 기본 분류는 추가하고, 사용자가 만들지 않은 기본 분류의 이름·화면 순서만 새 값으로 바꾼다.
// 기록(transactions)은 분류 번호만 가리키므로 건드리지 않는다. 여러 번 불러도 안전하다.
export async function syncDefaultCategories(db) {
  const tx = db.transaction('categories', 'readwrite');
  const store = tx.objectStore('categories');
  for (const def of DEFAULT_CATEGORIES) {
    const old = await reqToPromise(store.get(def.id));
    if (!old) store.put(def);
    else if (!old.isUserDefined && (old.name !== def.name || old.order !== def.order)) {
      store.put({ ...old, name: def.name, order: def.order });
    }
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// 앱이 쓰는 입구: 열고, 기본값을 채우고, 돌려준다
export async function initDb(name = DB_NAME) {
  const db = await openDb(name);
  await seedIfEmpty(db);
  await syncDefaultCategories(db);
  return db;
}

// ---- 기본 도구 ----
export function newId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function dbGet(db, store, key) {
  return reqToPromise(db.transaction(store).objectStore(store).get(key));
}

export function dbGetAll(db, store) {
  return reqToPromise(db.transaction(store).objectStore(store).getAll());
}

export function dbGetAllByIndex(db, store, index, query) {
  return reqToPromise(db.transaction(store).objectStore(store).index(index).getAll(query));
}

export function dbPut(db, store, value) {
  return reqToPromise(db.transaction(store, 'readwrite').objectStore(store).put(value));
}

export function dbDelete(db, store, key) {
  return reqToPromise(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export function deleteDb(name) {
  // 열려 있던 연결이 막 닫히는 중이면 "막힘" 알림이 먼저 올 수 있다.
  // 알림만으로 실패 처리하지 않고, 연결이 닫히면 삭제가 이어지도록 기다린다(최대 5초).
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('삭제가 막혔어요. 열려 있는 창을 닫고 다시 해 주세요.')), 5000);
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => { clearTimeout(timer); resolve(); };
    req.onerror = () => { clearTimeout(timer); reject(req.error); };
  });
}

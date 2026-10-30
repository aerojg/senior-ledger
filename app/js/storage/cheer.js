/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 기록 직후 한 줄 응원 (화면흐름 S5 1번, 말풀이틀 4~6번, D43).
// 규칙: 설정의 "한 줄 응원"이 켜져 있을 때만, 하루 2번까지만 보인다. 나머지는 완료 화면의 "기록했어요" 확인만 보인다.
// 필수 지출에는 농담·칭찬 없이 세 코치가 같은 담담한 말을 쓴다. 한 번 본 문구는 90일 쉰다(phraseSeen, 백업 파일에는 넣지 않음).
import { dbGet, dbGetAll, dbPut } from './db.js';
import { todayStr } from './dates.js';
import { phraseList, fillPhrase, hashText } from '../content/phrases.js';

export const DAILY_LIMIT = 2;
export const REST_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// 어떤 상황의 응원인지 고른다. 응원을 붙이지 않는 기록(이체)은 null.
// 우선순위: 필수 지출(담담하게) > 첫 기록 > 받은 돈 > 일반 지출
export function pickSituation(rows, hasOthers) {
  if (rows.length === 0) return null;
  if (rows.length > 1) return 'recordMany';
  const t = rows[0];
  if (t.type === 'transfer') return null;
  if (t.type !== 'income' && t.essential) return 'recordEssential';
  if (!hasOthers) return 'recordFirst';
  if (t.type === 'income') return 'recordIncome';
  return 'recordExpense';
}

// 쉬는 중이 아닌 번호 중에서 하나를 고른다. 모두 쉬는 중이면 가장 오래전에 본 것부터 쓴다.
// seen: { 번호: 본 시각 }
export function pickIndex(count, seen, now, seed) {
  const restMs = REST_DAYS * DAY_MS;
  const open = [];
  for (let i = 0; i < count; i++) if (!(i in seen) || now - seen[i] >= restMs) open.push(i);
  if (open.length > 0) return open[hashText(seed) % open.length];
  let oldest = 0;
  for (let i = 1; i < count; i++) if (seen[i] < seen[oldest]) oldest = i;
  return oldest;
}

async function readRows(db, ids) {
  const rows = [];
  for (const id of ids) {
    const t = await dbGet(db, 'transactions', id);
    if (t && !t.deletedAt) rows.push(t);
  }
  return rows;
}

async function compute(db, settings, saved, today) {
  if (settings && settings.showCheer === false) return null;
  const day = await dbGet(db, 'meta', 'cheerDay');
  const used = day && day.value && day.value.date === today ? day.value.count : 0;
  if (used >= DAILY_LIMIT) return null;

  const ids = saved.ids || [saved.id];
  const rows = await readRows(db, ids);
  const idSet = new Set(ids);
  const hasOthers = (await dbGetAll(db, 'transactions')).some((t) => !t.deletedAt && !idSet.has(t.id));
  const situation = pickSituation(rows, hasOthers);
  if (!situation) return null;

  const coach = (settings && settings.coachStyle) || 'neighbor';
  const list = phraseList(situation, coach);
  if (list.length === 0) return null;
  const prefix = coach + ':' + situation + ':';
  const seen = {};
  for (const r of await dbGetAll(db, 'phraseSeen')) {
    if (typeof r.phraseId === 'string' && r.phraseId.startsWith(prefix)) seen[Number(r.phraseId.slice(prefix.length))] = r.seenAt;
  }
  const now = Date.now();
  const idx = pickIndex(list.length, seen, now, ids.join(',') + '|' + today);
  let categoryName = saved.categoryName;
  if (!categoryName && rows[0] && rows[0].categoryId) {
    const c = await dbGet(db, 'categories', rows[0].categoryId);
    categoryName = c && c.name;
  }
  const text = fillPhrase(list[idx], { 분류: categoryName || '이 지출' });

  await dbPut(db, 'phraseSeen', { phraseId: prefix + idx, seenAt: now });
  await dbPut(db, 'meta', { key: 'cheerDay', value: { date: today, count: used + 1 } });
  return text;
}

// 완료 화면에 보일 한 줄. 결과는 saved.cheer에 적어 두어, 화면을 다시 열어도 같은 글이 나오고 횟수는 더 줄지 않는다.
// 계산에 실패해도 완료 화면은 그대로 열린다(응원 없이).
export async function cheerFor(db, settings, saved, today = todayStr()) {
  if (!saved) return null;
  if ('cheer' in saved) return saved.cheer;
  let text = null;
  try {
    text = await compute(db, settings, saved, today);
  } catch (e) {
    console.error(e);
  }
  saved.cheer = text;
  return text;
}

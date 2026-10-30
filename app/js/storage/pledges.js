/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 약속(S8)의 저장과 계산 - 화면을 모르는 부분 (화면흐름 v1.1 S8, 말풀이틀 v1.0)
// 정한 기본값: 한 달 단위, 금액 한도만, 한도 = 평소 평균 x 90%를 만 원 단위로 내림, 동시에 한 가지만.
// 숫자 기준은 제안값이며 시니어 시험 뒤 조정한다 (Q32).
import { dbGet, dbGetAll, dbPut, newId } from './db.js';
import { getJar } from './jars.js';
import { periodRange, shiftPeriodKey } from './dates.js';
import { listTransactionsByPeriod } from './transactions.js';
import { summarizeMonth, buildBaseline, risingItems, isCountable } from '../analysis/month.js';

export const PLEDGE_PERCENT = 90;      // 평소 평균의 몇 %를 한도로 할지
export const PLEDGE_STEP = 10000;      // 한도는 만 원 단위로 내린다

// 평소 평균 -> 한도 (만 원 단위 내림). 정수 계산만 쓴다.
export function suggestLimit(base) {
  return Math.floor((base * PLEDGE_PERCENT) / (100 * PLEDGE_STEP)) * PLEDGE_STEP;
}

// 늘어난 항목 -> 약속 후보 (늘어난 금액이 큰 순서)
export function buildSuggestions(summary, baseline, max = 3) {
  return risingItems(summary, baseline, max)
    .map((r) => ({ categoryId: r.id, name: r.name, base: r.base, lastAmount: r.amount, limitValue: suggestLimit(r.base) }))
    .filter((s) => s.limitValue >= PLEDGE_STEP);
}

// 지난 달(끝난 달)을 보고 후보를 만든다. 평소 기준은 결산 화면과 같은 방식(그 앞 3개월)이다.
export async function loadSuggestions(db, nowKey, startDay, categories) {
  const lastKey = shiftPeriodKey(nowKey, -1);
  const summary = summarizeMonth(await listTransactionsByPeriod(db, lastKey, startDay), categories);
  const prev = [];
  for (let i = 1; i <= 3; i++) {
    const k = shiftPeriodKey(lastKey, -i);
    prev.push({ key: k, summary: summarizeMonth(await listTransactionsByPeriod(db, k, startDay), categories) });
  }
  const baseline = buildBaseline(prev);
  return { basedOnKey: lastKey, baselineMonths: baseline.months, suggestions: buildSuggestions(summary, baseline) };
}

// ---- 저장 ----
export async function listPledges(db) {
  const all = await dbGetAll(db, 'pledges');
  return all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function getActivePledge(db) {
  const all = await listPledges(db);
  return all.find((p) => p.status === 'active') || null;
}

export async function getPledge(db, id) {
  return (await dbGet(db, 'pledges', id)) || null;
}

// 약속 만들기. 진행 중인 약속이 있으면 만들지 않는다 (한 번에 한 가지).
export async function createPledge(db, input) {
  const { categoryId, title, limitValue, baselineValue, periodKey, startDay = 1 } = input;
  if (!categoryId) throw new Error('분류를 골라 주세요.');
  if (!Number.isInteger(limitValue) || limitValue <= 0) throw new Error('한도 금액이 올바르지 않아요.');
  if (!/^\d{4}-\d{2}$/.test(periodKey || '')) throw new Error('기간이 올바르지 않아요.');
  if (await getActivePledge(db)) throw new Error('이미 진행 중인 약속이 있어요.');
  const range = periodRange(periodKey, startDay);
  const pledge = {
    id: newId(),
    title: title || '',
    categoryId,
    limitType: 'amount',
    limitValue,
    period: 'month',
    periodKey,
    startDate: range.start,
    endDate: range.end,
    baselineValue: Number.isFinite(baselineValue) ? baselineValue : 0,
    baselineMethod: 'avg3m',
    baselineMonths: Number.isInteger(input.baselineMonths) && input.baselineMonths >= 1 && input.baselineMonths <= 3 ? input.baselineMonths : 3,
    defaultJarId: input.defaultJarId || null,
    status: 'active',
    createdAt: Date.now(),
  };
  await dbPut(db, 'pledges', pledge);
  return pledge;
}

// 약속 끝내기: kept(지켰어요) / missed(못 지켰어요) / ended(그만뒀어요)
export async function closePledge(db, id, status) {
  if (!['kept', 'missed', 'ended'].includes(status)) throw new Error('알 수 없는 상태예요.');
  const p = await getPledge(db, id);
  if (!p) throw new Error('약속을 찾지 못했어요.');
  if (p.status !== 'active') return p;
  const next = { ...p, status, closedAt: Date.now() };
  await dbPut(db, 'pledges', next);
  return next;
}

// ---- 이번 달 건너뛰기 (meta에 "건너뛴 달"을 적어 둔다) ----
export async function skipSuggestion(db, nowKey) {
  await dbPut(db, 'meta', { key: 'pledgeSkipKey', value: nowKey });
}
export async function isSuggestionSkipped(db, nowKey) {
  const m = await dbGet(db, 'meta', 'pledgeSkipKey');
  return !!m && m.value === nowKey;
}

// ---- 진행 계산 ----
function dayNumber(s) {                       // 'YYYY-MM-DD' -> 날짜 번호 (시간대 영향 없음)
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

// 진행: 쓴 돈(평소 지출로 세는 것만), 남은 돈, 남은 날, 단계(ok/near/over)
export async function pledgeProgress(db, pledge, startDay, today) {
  const rows = await listTransactionsByPeriod(db, pledge.periodKey, startDay);
  let actual = 0;
  for (const r of rows) if (r.categoryId === pledge.categoryId && isCountable(r)) actual += r.amount;
  const limit = pledge.limitValue;
  const ended = today > pledge.endDate;
  const daysLeft = ended ? 0 : dayNumber(pledge.endDate) - Math.max(dayNumber(today), dayNumber(pledge.startDate)) + 1;
  const level = actual > limit ? 'over' : actual * 10 >= limit * 8 ? 'near' : 'ok';
  return {
    actual, limit, remaining: limit - actual,
    percent: Math.min(100, Math.round((actual * 100) / limit)),
    ended, daysLeft, level,
    result: ended ? (actual <= limit ? 'kept' : 'missed') : null,
  };
}

// ---- 성적표 (pledgeResults) ----
// 한 약속에 성적표는 하나다. 번호를 약속 번호로 정해 두어 같은 성적표를 두 번 만들어도 한 건만 남는다.
// 아낀 돈은 약속을 지켰을 때만 생기고 (평소 평균 - 실제로 쓴 돈) 이다 (말풀이틀 1번).
export function buildResult(pledge, actual, now = Date.now()) {
  const kept = actual <= pledge.limitValue;
  return {
    id: 'result-' + pledge.id,
    pledgeId: pledge.id,
    periodKey: pledge.periodKey,
    categoryId: pledge.categoryId,
    title: pledge.title,
    actualValue: actual,
    limitValue: pledge.limitValue,
    baselineValue: pledge.baselineValue || 0,
    baselineMonths: pledge.baselineMonths || 3,
    result: kept ? 'kept' : 'missed',
    savedAmount: kept ? Math.max(0, (pledge.baselineValue || 0) - actual) : 0,
    assignedJarId: null,          // "이 돈, 어디에 모을까요?"에서 정한 칸 (아직 안 정했으면 비어 있음)
    assignedAt: null,
    computedAt: now,
  };
}

export async function listResults(db) {
  const all = await dbGetAll(db, 'pledgeResults');
  return all.sort((a, b) => (a.periodKey < b.periodKey ? 1 : a.periodKey > b.periodKey ? -1 : 0));
}

export async function getResult(db, pledgeId) {
  return (await dbGet(db, 'pledgeResults', 'result-' + pledgeId)) || null;
}

// 기간이 끝났으면 성적표를 만들고 약속의 결과를 저장한다. 끝나지 않았으면 그대로 돌려준다.
// 성적표를 먼저 저장하고 약속 상태를 바꾸므로, 중간에 끊겨도 다시 불러 같은 결과를 얻는다.
export async function closeIfEnded(db, pledge, startDay, today) {
  if (pledge.status !== 'active') return pledge;
  const pr = await pledgeProgress(db, pledge, startDay, today);
  if (!pr.ended) return pledge;
  const existing = await getResult(db, pledge.id);
  const res = existing || buildResult(pledge, pr.actual);
  if (!existing) await dbPut(db, 'pledgeResults', res);
  return closePledge(db, pledge.id, res.result);
}

// 아직 칸을 정하지 않은 아낀 돈이 있는 성적표 (최근 것부터)
export async function listUnassigned(db) {
  return (await listResults(db)).filter((r) => r.savedAmount > 0 && !r.assignedJarId);
}

// "이 돈, 어디에 모을까요?": 아낀 돈을 고른 칸에 'saved' 기록으로 남긴다.
// 저금통은 가상이라 실제 돈은 움직이지 않고, 계산된 아낀 돈만 기록한다 (R06).
// 기록 번호를 성적표에 묶어 두어서 같은 성적표를 두 번 담아도 한 번만 기록된다.
export async function assignSavedToJar(db, resultId, jarId, date) {
  const res = await dbGet(db, 'pledgeResults', resultId);
  if (!res) throw new Error('성적표를 찾지 못했어요.');
  if (!(res.savedAmount > 0)) throw new Error('담을 아낀 돈이 없어요.');
  if (res.assignedJarId) return res;
  const jar = await getJar(db, jarId);
  if (!jar || jar.deletedAt) throw new Error('저금통 칸을 찾지 못했어요.');
  const now = Date.now();
  await dbPut(db, 'jarEntries', {
    id: 'saved-' + res.id,
    jarId,
    date,
    kind: 'saved',
    amount: res.savedAmount,
    memo: res.title + ' 약속에서 아낀 돈',
    pledgeResultId: res.id,
    createdAt: now,
  });
  const next = { ...res, assignedJarId: jarId, assignedAt: now };
  await dbPut(db, 'pledgeResults', next);
  return next;
}

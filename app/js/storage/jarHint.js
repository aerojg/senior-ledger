/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 남은 돈 안내 (D113): 월 결산 뒤 남은 돈 가운데, 아직 어디에도 저금하지 않은 돈만 알려 준다.
// 계산: (직전에 끝난 달의 들어온 돈 - 쓴 돈) - (이번 달에 남은 돈 모음에 저금한 돈)
// 미리 모으는 칸에 저금한 돈은 홈에 쓴 돈으로 이미 기록되므로 결산의 남은 돈에서 빠져 있다. 따로 빼지 않는다 (D113).
// 홈과 연결되기 전에 적은 옛 저금 기록(transactionId 없음)만, 쓴 돈에 들어 있지 않으므로 한 번 뺀다.
// 수입을 기록하지 않았으면 남은 돈을 알 수 없으므로 안내하지 않는다(저금 기록은 언제든 할 수 있다).
// "이번엔 안 해요"를 누르면 그 달 안내는 다시 보이지 않는다(meta jarHintDismissed).
import { dbGet, dbGetAll, dbPut } from './db.js';
import { todayStr, periodKeyOf, periodRange, shiftPeriodKey } from './dates.js';
import { listTransactionsByPeriod } from './transactions.js';
import { summarizeMonth } from '../analysis/month.js';
import { movedByKind } from './jars.js';

export const DISMISS_KEY = 'jarHintDismissed';

// 돌려주는 값: 안내할 것이 없으면 null, 있으면 { periodKey, month, balance, reserve, surplus, left }
export async function getJarHint(db, startDay = 1, today = todayStr()) {
  const nowKey = periodKeyOf(today, startDay);
  const lastKey = shiftPeriodKey(nowKey, -1);
  const dismissed = await dbGet(db, 'meta', DISMISS_KEY);
  if (dismissed && dismissed.value === lastKey) return null;
  const categories = await dbGetAll(db, 'categories');
  const rows = await listTransactionsByPeriod(db, lastKey, startDay);
  const s = summarizeMonth(rows, categories);
  if (!(s.income > 0) || !(s.balance > 0)) return null;
  const last = periodRange(lastKey, startDay);
  const now = periodRange(nowKey, startDay);
  const reserve = (await movedByKind(db, last.start, last.end, { skipStatsOff: true })).reserveLegacy;   // 통계에서 뺀 칸은 없는 것으로 본다 (D140)
  const surplus = (await movedByKind(db, now.start, now.end)).surplus;
  const left = s.balance - reserve - surplus;
  if (left <= 0) return null;
  return { periodKey: lastKey, month: Number(lastKey.split('-')[1]), balance: s.balance, reserve, surplus, left };
}

export async function dismissJarHint(db, periodKey) {
  await dbPut(db, 'meta', { key: DISMISS_KEY, value: periodKey });
}

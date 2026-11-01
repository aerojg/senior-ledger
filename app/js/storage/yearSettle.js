/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 저금통 연말 결산 (D114·D124, 5단계 연간 결산 3단계 나). 예전 이름은 '연말 정산'이다.
// 규칙: 정산은 다음 해 1월 1일 ~ 2월 말일에 할 수 있다. 미리 모으는 칸마다 그해 모은 돈 - 쓴 돈(차이)을 정리한다.
//  - 차이가 마이너스(먼저 쓴 돈)면: 그해 12월 31일 쓴 돈으로 확정한다(분류 '기타', 메모에 칸 이름). 칸에는 같은 금액의 정산 기록을 남겨 0원으로 맞춘다.
//  - 차이가 플러스(남은 잔액)면: 칸에서 같은 금액을 정산 기록으로 빼서 0원으로 맞추고, 연간 결산의 쓴 돈에서만 뺀다(월 결산 숫자는 그대로).
//  - 남은 돈 모음은 정산하지 않는다. 정산 결과는 reviews 저장소에 'yearsettle-연도' 번호로 남기고, 취소하면 모두 되돌린다.
import { dbGet, dbGetAll, dbPut, dbDelete, newId } from './db.js';
import { addTransaction, softDeleteTransaction } from './transactions.js';
import { buildJarYear } from '../analysis/month.js';
import { todayStr } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');
const OTHER_CATEGORY = 'c14';   // 기타

function fail(message) {
  const e = new Error(message);
  e.userMessage = message;
  return e;
}

export const settleReviewId = (year) => 'yearsettle-' + year;

// 저금통 연말 결산을 할 수 있는 기간: 다음 해 1월 1일 ~ 2월 말일 (윤년 반영)
export function settleWindow(year) {
  const y = Number(year) + 1;
  const last = new Date(y, 2, 0).getDate();
  return { start: y + '-01-01', end: y + '-02-' + pad(last) };
}
export function isSettleOpen(year, today) {
  const w = settleWindow(year);
  return today >= w.start && today <= w.end;
}

export async function getYearSettlement(db, year) {
  const r = await dbGet(db, 'reviews', settleReviewId(year));
  return r && !r.undoneAt ? r : null;
}

// 정산하면 어떻게 되는지 미리 계산한다(저장하지 않는다)
export async function planYearSettle(db, year) {
  const jy = buildJarYear(await dbGetAll(db, 'jars'), await dbGetAll(db, 'jarEntries'), year);
  const rows = jy.rows.filter((r) => r.diff !== 0);
  return {
    rows,
    coverTotal: rows.filter((r) => r.diff < 0).reduce((a, r) => a + -r.diff, 0),
    refundTotal: rows.filter((r) => r.diff > 0).reduce((a, r) => a + r.diff, 0),
  };
}

// 정산을 실행한다. 이미 했으면 막는다. 중간에 실패하면 그때까지 만든 것을 되돌린다.
export async function runYearSettle(db, year, today) {
  if (!isSettleOpen(year, today)) throw fail('저금통 연말 결산은 ' + (Number(year) + 1) + '년 1월 1일부터 2월 말일까지 할 수 있어요.');
  if (await getYearSettlement(db, year)) throw fail('이미 결산했어요.');
  const plan = await planYearSettle(db, year);
  if (plan.rows.length === 0) throw fail('결산할 돈이 없어요.');
  const date = year + '-12-31';
  const now = Date.now();
  const items = [];
  const madeTx = [];
  const madeEntries = [];
  try {
    for (const r of plan.rows) {
      const entry = { id: newId(), jarId: r.id, date, amount: Math.abs(r.diff), settle: r.diff < 0 ? 'cover' : 'refund', memo: '연말 결산', createdAt: now };
      const item = { jarId: r.id, name: r.name, moved: r.moved, used: r.used, diff: r.diff, entryId: entry.id };
      if (r.diff < 0) {
        const tx = await addTransaction(db, {
          type: 'expense', date, amount: -r.diff, categoryId: OTHER_CATEGORY, costType: 'variable', essential: false,
          source: 'settle', memo: '저금통 연말 결산: ' + r.name,
        });
        madeTx.push(tx.id);
        item.transactionId = tx.id;
        entry.kind = 'moved';   // 먼저 쓴 돈만큼 채워 0원으로 맞춘다
      } else {
        entry.kind = 'used';    // 남은 잔액만큼 빼서 0원으로 맞춘다
      }
      await dbPut(db, 'jarEntries', entry);
      madeEntries.push(entry.id);
      items.push(item);
    }
    const review = {
      id: settleReviewId(year), periodType: 'yearsettle', periodKey: String(year), settledAt: now, settledOn: today,
      items, coverTotal: plan.coverTotal, refundTotal: plan.refundTotal,
    };
    await dbPut(db, 'reviews', review);
    return review;
  } catch (e) {
    for (const id of madeTx) { try { await softDeleteTransaction(db, id); } catch (e2) { console.error(e2); } }
    for (const id of madeEntries) { try { await dbDelete(db, 'jarEntries', id); } catch (e2) { console.error(e2); } }
    throw e;
  }
}

// 정산을 취소한다: 만든 쓴 돈 기록과 칸의 정산 기록을 지우고 정산 결과를 없앤다.
export async function undoYearSettle(db, year) {
  const review = await getYearSettlement(db, year);
  if (!review) throw fail('취소할 결산이 없어요.');
  for (const it of review.items) {
    if (it.transactionId) { try { await softDeleteTransaction(db, it.transactionId); } catch (e) { console.error(e); } }
    try { await dbDelete(db, 'jarEntries', it.entryId); } catch (e) { console.error(e); }
  }
  await dbDelete(db, 'reviews', review.id);
}

// 연간 결산에서 쓴 돈에서 뺄 되돌림 합계
export async function refundTotalOf(db, year) {
  const r = await getYearSettlement(db, year);
  return r ? r.refundTotal : 0;
}

// ---- 홈 안내 줄 (Q67, D125) ----
// 시험할 때만 브라우저 콘솔에서 window.__GB_TODAY__ = '2027-01-05' 로 오늘을 바꿀 수 있다.
export const settleTodayStr = () => (typeof window !== 'undefined' && window.__GB_TODAY__) || todayStr();

const MS_DAY = 86400000;
const dayNumber = (s) => Math.round(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / MS_DAY);
export const URGENT_DAYS = 14;   // 마감 며칠 전부터 남은 날을 알려 줄지 (제안값)

// 홈에 안내 줄을 보일지 정한다. 지난해 저금통을 결산할 수 있는 기간이고, 아직 결산하지 않았고, 결산할 돈이 있고,
// 오늘 [나중에]를 누르지 않았을 때만 보인다. 이미 결산했으면 보이지 않는다.
export async function settleBannerState(db, today = settleTodayStr()) {
  const year = Number(today.slice(0, 4)) - 1;
  if (!isSettleOpen(year, today)) return null;
  const hidden = await dbGet(db, 'meta', 'settleBannerHiddenOn');
  if (hidden && hidden.value === year + ':' + today) return null;
  if (await getYearSettlement(db, year)) return null;
  const plan = await planYearSettle(db, year);
  if (plan.rows.length === 0) return null;
  const end = settleWindow(year).end;
  const daysLeft = dayNumber(end) - dayNumber(today);
  return { year, end, daysLeft, urgent: daysLeft <= URGENT_DAYS };
}

// [나중에]: 오늘 하루만 숨기고 내일 다시 보인다
export async function hideSettleBanner(db, today = settleTodayStr()) {
  const year = Number(today.slice(0, 4)) - 1;
  await dbPut(db, 'meta', { key: 'settleBannerHiddenOn', value: year + ':' + today });
}

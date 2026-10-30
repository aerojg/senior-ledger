/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 약속의 주간 중간점검 (화면흐름 S8 2번, 말풀이틀 4-1 "주간 중간점검(순조로움·주의)").
// 지금까지 쓴 속도로 약속 기간이 끝날 때 얼마가 될지 어림해서 한도와 견준다. 저장하는 것은 없고 계산만 한다.
// 7일이 지나야 점검을 보이고, 이미 한도를 넘었거나 약속이 끝났으면 보이지 않는다(그때는 약속 카드의 안내가 있다).

function dayNumber(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export const CHECK_MIN_DAYS = 7;
export const CHECK_ROUND = 1000;   // 어림값은 천 원 단위로 보인다

// pledge: { startDate, endDate, limitValue }, actual: 지금까지 쓴 돈, today: 'YYYY-MM-DD'
// 돌려주는 값: null 또는 { weeks, elapsed, total, projected, status: 'good'|'care' }
export function weeklyCheck(pledge, actual, today) {
  if (!pledge || !pledge.startDate || !pledge.endDate || !(pledge.limitValue > 0)) return null;
  if (today > pledge.endDate || today < pledge.startDate) return null;
  if (actual > pledge.limitValue) return null;
  const total = dayNumber(pledge.endDate) - dayNumber(pledge.startDate) + 1;
  const elapsed = dayNumber(today) - dayNumber(pledge.startDate) + 1;
  if (elapsed < CHECK_MIN_DAYS || total <= 0) return null;
  const projected = Math.round(((actual / elapsed) * total) / CHECK_ROUND) * CHECK_ROUND;
  return {
    weeks: Math.floor(elapsed / 7),
    elapsed,
    total,
    projected,
    status: actual / elapsed * total <= pledge.limitValue ? 'good' : 'care',
  };
}

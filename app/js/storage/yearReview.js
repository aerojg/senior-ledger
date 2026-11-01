/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 연간 결산 결과 저장 (D114, 5단계 연간 결산 4단계)
// 해가 끝난 뒤 연간 결산에서 [이 해 결과 저장]을 누르면 그때의 숫자를 reviews 저장소에 남긴다.
// 저장한 숫자는 나중에 기록을 고쳐도 바뀌지 않고, 다시 저장하면 새 숫자로 덮어쓴다. 다음 해에 2년째 비교에 쓴다.
// 번호: 'year-연도', periodType: 'year' (정산 결과 'yearsettle-연도'와는 다른 기록이다)
import { dbGet, dbPut } from './db.js';

export const yearReviewId = (year) => 'year-' + year;

export async function getYearReview(db, year) {
  return (await dbGet(db, 'reviews', yearReviewId(year))) || null;
}

// snapshot: { months, expense, avg, income, balance(없으면 null), refund, cats:[{id,name,amount}], jars:[{name,moved,used,diff}] }
export async function saveYearReview(db, year, snapshot, today) {
  const old = await getYearReview(db, year);
  const rec = {
    id: yearReviewId(year), periodType: 'year', periodKey: String(year),
    savedAt: Date.now(), savedOn: today, snapshot,
  };
  if (old && old.firstSavedAt) rec.firstSavedAt = old.firstSavedAt;
  else rec.firstSavedAt = rec.savedAt;
  await dbPut(db, 'reviews', rec);
  return rec;
}

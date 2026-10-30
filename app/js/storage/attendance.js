/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 출석 도장 (화면흐름 S1 5번, 데이터구조 P8): 별도 저장소 없이 기록에서 계산한다.
// 도장은 "앱에 기록한 날"(기록을 만든 시각 createdAt의 지역 날짜)에 찍힌다. 기록 속 날짜(date)가 아니다(사용자 결정, 2026-10-30).
// 삭제한 기록(방금 기록 취소 포함)은 세지 않는다. 한 주는 월요일부터 일요일까지다.
import { dbGetAll } from './db.js';
import { toDateStr, todayStr } from './dates.js';

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

function parse(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 그 날이 속한 주의 월요일 날짜
export function weekStartOf(dateStr) {
  const d = parse(dateStr);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateStr(d);
}

// 월~일 7일의 날짜 문자열
export function weekDates(dateStr) {
  const start = parse(weekStartOf(dateStr));
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    out.push(toDateStr(d));
  }
  return out;
}

// 기록 목록에서 도장이 찍힌 날짜 모음을 만든다
export function stampedDates(rows) {
  const set = new Set();
  for (const t of rows || []) {
    if (t.deletedAt) continue;
    if (typeof t.createdAt !== 'number' || !isFinite(t.createdAt)) continue;
    set.add(toDateStr(new Date(t.createdAt)));
  }
  return set;
}

// 이번 주(월~일)에 앱에 기록한 건수. 도장과 같은 기준(만든 날)으로 세고, 삭제한 기록은 뺀다.
export function weekRecordCount(rows, dates) {
  const set = new Set(dates);
  let n = 0;
  for (const t of rows || []) {
    if (t.deletedAt) continue;
    if (typeof t.createdAt !== 'number' || !isFinite(t.createdAt)) continue;
    if (set.has(toDateStr(new Date(t.createdAt)))) n += 1;
  }
  return n;
}

// 이번 주 도장판: { days: [{ date, label, stamped, isToday, isFuture }], count(기록한 날수), total(기록 건수) }
export async function weekStamps(db, today = todayStr()) {
  const dates = weekDates(today);
  const rows = await dbGetAll(db, 'transactions');
  const set = stampedDates(rows);
  const days = dates.map((date, i) => ({
    date,
    label: DAY_LABELS[i],
    stamped: set.has(date),
    isToday: date === today,
    isFuture: date > today,
  }));
  return { days, count: days.filter((d) => d.stamped).length, total: weekRecordCount(rows, dates) };
}

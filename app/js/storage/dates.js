// 날짜 도구: 모든 날짜는 사용자 기기의 지역 날짜 문자열 YYYY-MM-DD로 다룬다 (데이터구조 P2)
// toISOString()은 쓰지 않는다. 세계 표준시로 바뀌어 날짜가 하루 어긋날 수 있기 때문이다.

const pad = (n) => String(n).padStart(2, '0');

export function toDateStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function todayStr() {
  return toDateStr(new Date());
}

export function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateStr(d);
}

// 'YYYY-MM-DD' 형식이고 실제로 있는 날짜인지 검사한다 (예: 2026-02-30은 거짓)
export function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// 한 달의 기간: 기본은 매월 1일~말일, 시작일을 바꾸면 그 날부터 다음 달 전날까지 (화면흐름 6번)
// key는 'YYYY-MM' (기간이 시작되는 달)
export function periodRange(key, startDay = 1) {
  const [y, m] = key.split('-').map(Number);
  const start = new Date(y, m - 1, startDay);
  const nextStart = new Date(y, m, startDay);
  const end = new Date(nextStart.getFullYear(), nextStart.getMonth(), nextStart.getDate() - 1);
  return { start: toDateStr(start), end: toDateStr(end) };
}

// 어떤 날짜가 속한 기간의 key
export function periodKeyOf(dateStr, startDay = 1) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let yy = y, mm = m;
  if (d < startDay) {
    mm -= 1;
    if (mm === 0) { mm = 12; yy -= 1; }
  }
  return yy + '-' + pad(mm);
}

export function shiftPeriodKey(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}

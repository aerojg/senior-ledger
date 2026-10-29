/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 금액·날짜 표시 도구

// 35000 -> "35,000원"
export function formatWon(n) {
  return Number(n).toLocaleString('ko-KR') + '원';
}

// 글자에서 숫자만 남긴다: "3a5,000" -> "35000"
export function onlyDigits(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

// "35000" -> "35,000" (천 단위 쉼표)
export function withCommas(digits) {
  return String(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 금액을 한글로 읽어 준다 (잘못 누른 것을 바로 알 수 있게 함, Q26): 35000 -> "삼만 오천 원"
const DIGIT = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
function readGroup(n) { // 1~9999
  let out = '';
  for (const [unit, name] of [[1000, '천'], [100, '백'], [10, '십']]) {
    const d = Math.floor(n / unit);
    n %= unit;
    if (d > 0) out += (d === 1 ? '' : DIGIT[d]) + name;
  }
  if (n > 0) out += DIGIT[n];
  return out;
}
export function koreanAmount(amount) {
  let n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n < 1) return '';
  const parts = [];
  for (const [unit, name] of [[1e12, '조'], [1e8, '억'], [1e4, '만'], [1, '']]) {
    const g = Math.floor(n / unit) % 10000;
    if (g > 0) parts.push(name === '만' && g === 1 ? '만' : readGroup(g) + name);
  }
  return parts.join(' ') + ' 원';
}

// "2026-10-24" -> "10월 24일 (토)"
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export function formatDateKo(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = new Date(y, m - 1, d).getDay();
  return m + '월 ' + d + '일 (' + WEEK[w] + ')';
}

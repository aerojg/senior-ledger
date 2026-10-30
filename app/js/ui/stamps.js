/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 이번 주 출석 도장 7칸 카드 (화면흐름 S1 5번, S5 2번). 홈과 기록 완료 화면에서 쓴다.
// 도장이 없는 날을 나무라지 않는다. 상태는 색만이 아니라 ✓ 표시, 테두리 모양, 글자("오늘")로도 구분한다 (U5).
import { el } from './dom.js';
import { weekStamps } from '../storage/attendance.js';
import { todayStr } from '../storage/dates.js';

const FULL = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];

// week: weekStamps()의 결과 { days: [...], count }
export function stampText(week) {
  if (week.count === 0) return '아직 이번 주 도장이 없어요. 기록을 남기면 오늘 도장이 찍혀요.';
  const total = week.total != null ? ' ' + week.total + '건' : '';
  if (week.count >= 7) return '이번 주 7일 모두 기록하셨어요.' + (total ? ' 모두' + total + '이에요.' : '');
  return '이번 주 ' + week.count + '일' + total + ' 기록하셨어요.';
}

export function stampCard(week) {
  const cells = week.days.map((d, i) => {
    const state = d.stamped ? 'on' : d.isFuture ? 'future' : 'off';
    const what = d.stamped ? '도장 찍힘' : d.isFuture ? '아직 오지 않음' : '도장 없음';
    return el('li', {
      class: 'stamp-cell ' + state + (d.isToday ? ' today' : ''),
      'aria-label': FULL[i] + (d.isToday ? ' 오늘 ' : ' ') + what,
    },
    el('span', { class: 'stamp-day', 'aria-hidden': 'true' }, d.label),
    el('span', { class: 'stamp-mark', 'aria-hidden': 'true' }, d.stamped ? '✓' : ''),
    el('span', { class: 'stamp-now', 'aria-hidden': 'true' }, d.isToday ? '오늘' : ''));
  });
  return el('div', { class: 'card stamp-card' },
    el('p', { class: 'kicker' }, '이번 주 도장'),
    el('ul', { class: 'stamp-row', role: 'list' }, ...cells),
    el('p', { class: 'meta line-tight' }, stampText(week)),
  );
}

// 기록 완료 화면(S5 2번)에 보이는 이번 주 도장판. 계산에 실패하면 없이 이어진다.
export async function doneStamps(ctx) {
  try {
    return stampCard(await weekStamps(ctx.db, todayStr()));
  } catch (e) {
    console.error(e);
    return null;
  }
}

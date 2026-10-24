// S1 홈 (화면흐름 v1.0): 인사, 이번 달 한 줄, 큰 기록 버튼 두 개
// 월 중에는 신호등을 칠하지 않고 "지금까지"의 금액만 보인다 (D42).
import { el } from './dom.js';
import { formatWon } from './format.js';
import { todayStr, periodKeyOf } from '../storage/dates.js';
import { listTransactionsByPeriod, sumTransactions } from '../storage/transactions.js';

export async function homeView(ctx) {
  const startDay = ctx.settings.monthStartDay || 1;
  const key = periodKeyOf(todayStr(), startDay);
  const rows = await listTransactionsByPeriod(ctx.db, key, startDay);
  const sums = sumTransactions(rows);

  const monthCard = rows.length === 0
    ? el('div', { class: 'card' },
        el('p', {}, '아직 기록이 없어요. 첫 기록을 남겨 볼까요?'))
    : el('div', { class: 'card' },
        el('p', { class: 'muted' }, '이번 달 지금까지 쓴 돈'),
        el('p', { class: 'big-number' }, formatWon(sums.expense)),
        el('p', { class: 'muted' }, '기록 ' + rows.length + '건'),
        el('a', { class: 'btn', href: '#/history' }, '내역 보기'));

  return el('section', { class: 'home' },
    el('h1', {}, '가계부자'),
    monthCard,
    el('div', { class: 'spacer' }),
    // 엄지가 닿는 아래쪽에 큰 버튼 두 개
    el('a', { class: 'btn primary', href: '#/write' }, '직접 쓰기'),
    el('a', { class: 'btn', href: '#/sms' }, '문자 붙여넣기'),
  );
}

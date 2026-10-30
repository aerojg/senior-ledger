/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// S1 홈 (화면흐름 v1.0): 인사, 이번 달 한 줄, 큰 기록 버튼 두 개
// 월 중에는 신호등을 칠하지 않고 "지금까지"의 금액만 보인다 (D42).
import { el } from './dom.js';
import { formatWon } from './format.js';
import { todayStr, periodKeyOf } from '../storage/dates.js';
import { listTransactionsByPeriod, sumTransactions } from '../storage/transactions.js';
import { listJars, listEntries, sumEntries } from '../storage/jars.js';
import { jarProgress } from './jar.js';
import { getActivePledge, pledgeProgress } from '../storage/pledges.js'; // PLEDGE-ENTRY
import { computeReminder, dismissReminder } from '../storage/backup.js';

export async function homeView(ctx) {
  const startDay = ctx.settings.monthStartDay || 1;
  const key = periodKeyOf(todayStr(), startDay);
  const rows = await listTransactionsByPeriod(ctx.db, key, startDay);
  const sums = sumTransactions(rows);

  const monthCard = rows.length === 0
    ? el('div', { class: 'card' },
        el('p', {}, '아직 기록이 없어요. 첫 기록을 남겨 볼까요?'))
    : el('div', { class: 'card' },
        el('p', { class: 'kicker' }, '이번 달 지금까지 쓴 돈'),
        el('p', { class: 'big-number' }, formatWon(sums.expense)),
        el('p', { class: 'meta' }, '기록 ' + rows.length + '건'),
        el('a', { class: 'btn', href: '#/history' }, '내역 보기'));

  // 저금통 요약: 맨 위 칸 하나 (S1 4번). 칸이 없으면 보이지 않는다.
  const jars = await listJars(ctx.db);
  let jarCard = null;
  if (jars.length > 0) {
    const sums = sumEntries(await listEntries(ctx.db, jars[0].id));
    jarCard = el('a', { class: 'card card-link', href: '#/jar' },
      jarProgress(jars[0], sums),
      el('p', { class: 'meta line-tight' }, '옮긴 돈 ' + formatWon(sums.balance)),
      el('p', { class: 'meta line-tight' }, '목표 ' + formatWon(jars[0].targetAmount)));
  }

  // 약속 진행 한 줄 (S1 3번): 진행 중인 약속이 있을 때만 보인다. 실패해도 홈은 그대로 열린다. PLEDGE-ENTRY
  let pledgeLine = null;
  try {
    const pl = await getActivePledge(ctx.db);
    if (pl) {
      const pr = await pledgeProgress(ctx.db, pl, startDay, todayStr());
      if (!pr.ended) {
        const mark = pr.level === 'ok' ? '●' : pr.level === 'near' ? '▲' : '■';
        pledgeLine = el('a', { class: 'card card-link', href: '#/pledge' },
          el('p', { class: 'kicker' }, '이번 달 약속'),
          el('p', {}, pl.title + ' ' + formatWon(pl.limitValue) + ' 안에서'),
          el('p', { class: 'meta line-tight' }, mark + ' ' + (pr.remaining >= 0 ? '남은 돈 ' : '넘은 돈 ') + formatWon(Math.abs(pr.remaining)) + ' · 남은 날 ' + pr.daysLeft + '일'));
      }
    }
  } catch (e) { console.error(e); }
  // 백업 안내 줄 (S1 6번, D45): 홈이 열리지 않는 일이 없도록 계산에 실패하면 줄만 빼고 보인다
  let backupBanner = null;
  try {
    const r = await computeReminder(ctx.db);
    if (r) {
      const text = r.reason === 'never' ? '아직 내 기록을 파일로 저장해 두지 않으셨어요.'
        : r.reason === 'new' ? '마지막으로 저장한 뒤 새 기록이 ' + r.count + '건 쌓였어요.'
        : '내 기록을 마지막으로 저장한 지 ' + r.days + '일이 지났어요.';
      backupBanner = el('div', { class: 'banner', role: 'status' },
        el('span', {}, text),
        el('div', { class: 'banner-actions' },
          el('a', { class: 'link-btn', href: '#/backup' }, '지금 저장'),
          el('button', {
            type: 'button', class: 'link-btn',
            onclick: async () => { try { await dismissReminder(ctx.db); } catch (e) { console.error(e); } backupBanner.remove(); },
          }, '나중에')));
    }
  } catch (e) { console.error(e); }

  return el('section', { class: 'home' },
    el('h1', {}, '홈'),
    monthCard,
    pledgeLine,
    jarCard,
    backupBanner,
    el('div', { class: 'spacer' }),
    // 엄지가 닿는 아래쪽에 큰 버튼 두 개
    el('a', { class: 'btn primary', href: '#/write' }, '직접 쓰기'),
    el('a', { class: 'btn', href: '#/sms' }, '문자 붙여넣기'),
  );
}

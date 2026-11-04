/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// S1 홈 (화면흐름 v1.0): 인사, 이번 달 한 줄, 큰 기록 버튼 두 개
// 월 중에는 신호등을 칠하지 않고 "지금까지"의 금액만 보인다 (D42).
// 금액 가리기: 금액 오른쪽의 눈 모양 단추를 누르면 홈의 금액이 ●●●●●로 바뀌고 다시 누르면 보인다.
// 고른 상태는 meta(amountsHidden)에 저장해 앱을 껐다 켜도 유지한다. 처음 설치했을 때는 금액이 보인다.
import { el } from './dom.js';
import { dbGet, dbPut } from '../storage/db.js';
import { formatWon } from './format.js';
import { todayStr, periodKeyOf } from '../storage/dates.js';
import { listTransactionsByPeriod, sumTransactions } from '../storage/transactions.js';
import { weekStamps } from '../storage/attendance.js'; // STAMPS-ENTRY
import { stampCard } from './stamps.js'; // STAMPS-ENTRY
import { computeReminder, dismissReminder } from '../storage/backup.js';
import { settleBannerState, hideSettleBanner, settleTodayStr } from '../storage/yearSettle.js'; // SETTLE-BANNER-ENTRY

const MASK = '●●●●●';
const HIDE_KEY = 'amountsHidden';

// 눈 모양 그림: 보이는 상태는 열린 눈, 가린 상태는 사선이 그어진 눈. 선 색은 글자색을 따른다 (U5)
const EYE_PATH = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
const ICON_OPEN = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + EYE_PATH + '</svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + EYE_PATH + '<path d="M3 3l18 18"/></svg>';

async function loadHidden(db) {
  try {
    const m = await dbGet(db, 'meta', HIDE_KEY);
    return !!(m && m.value === true);
  } catch (e) { console.error(e); return false; }   // 읽지 못하면 보이는 상태로 연다
}

async function saveHidden(db, hidden) {
  try { await dbPut(db, 'meta', { key: HIDE_KEY, value: hidden }); } catch (e) { console.error(e); }
}

export async function homeView(ctx) {
  let amountsHidden = await loadHidden(ctx.db);
  // 홈에 보이는 금액은 모두 amt()로 만들어 두었다가 단추를 누르면 한꺼번에 바꾼다
  const amounts = [];
  function amt(text) {
    const node = el('span', {}, amountsHidden ? MASK : text);
    amounts.push({ node, text });
    return node;
  }
  const toggleBtn = el('button', {
    type: 'button',
    'aria-label': '금액 가리기',
    title: '금액 가리기',
    'aria-pressed': String(amountsHidden),
    style: 'flex:none;display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;min-width:48px;padding:0;margin:0;'
      + 'border:2px solid currentColor;border-radius:50%;background:transparent;color:inherit;font:inherit;cursor:pointer;',
    onclick: () => {
      amountsHidden = !amountsHidden;
      for (const a of amounts) a.node.textContent = amountsHidden ? MASK : a.text;
      toggleBtn.innerHTML = amountsHidden ? ICON_OFF : ICON_OPEN;
      toggleBtn.setAttribute('aria-pressed', String(amountsHidden));
      saveHidden(ctx.db, amountsHidden);
    },
  });
  toggleBtn.innerHTML = amountsHidden ? ICON_OFF : ICON_OPEN;

  const startDay = ctx.settings.monthStartDay || 1;
  const key = periodKeyOf(todayStr(), startDay);
  const rows = await listTransactionsByPeriod(ctx.db, key, startDay);
  const sums = sumTransactions(rows);
  const shown = rows.filter((r) => !r.statsOff);   // 통계에서 뺀 칸의 기록은 건수에 넣지 않는다 (D140)

  const monthCard = shown.length === 0
    ? el('div', { class: 'card' },
        el('p', {}, '아직 기록이 없어요. 첫 기록을 남겨 볼까요?'))
    : el('div', { class: 'card' },
        el('p', { class: 'kicker' }, '이번 달 지금까지 쓴 돈'),
        el('div', { class: 'row' },
          el('p', { class: 'big-number' }, amt(formatWon(sums.expense))),
          toggleBtn),
        el('p', { class: 'meta' }, '기록 ' + shown.length + '건'),
        sums.fromReserve > 0
          ? el('p', { class: 'note' }, '미리 떼어 둔 돈으로 쓴 ', amt(formatWon(sums.fromReserve)), '은 넣지 않았어요.')
          : null,
        el('a', { class: 'btn', href: '#/history' }, '내역 보기'));

  // 저금통 요약 카드는 뺐다(D112): 홈은 기록하는 곳이고, 저금은 저금통 메뉴에서 본다.

  // 이번 주 출석 도장 7칸 (S1 5번): 계산에 실패해도 홈은 그대로 열린다. STAMPS-ENTRY
  let stamps = null;
  try {
    stamps = stampCard(await weekStamps(ctx.db, todayStr()));
  } catch (e) { console.error(e); }

  // 저금통 연말 결산 안내 줄 (Q67, D125): 지난해 저금통을 결산할 수 있는 기간(1월 1일~2월 말일)에, 아직 결산하지 않았고
  // 결산할 돈이 있을 때만 보인다. 마감 14일 전부터는 남은 날을 알려 준다. 이미 결산했으면 보이지 않는다. SETTLE-BANNER-ENTRY
  let settleBanner = null;
  try {
    const sb = await settleBannerState(ctx.db);
    if (sb) {
      const e = sb.end;
      const endText = Number(e.slice(5, 7)) + '월 ' + Number(e.slice(8, 10)) + '일';
      const text = sb.urgent
        ? '▲ 저금통 연말 결산 마감까지 ' + (sb.daysLeft === 0 ? '오늘이 마지막 날이에요.' : sb.daysLeft + '일 남았어요. (' + endText + '까지)')
        : sb.year + '년 저금통을 결산할 때예요. ' + endText + '까지 할 수 있어요.';
      settleBanner = el('div', { class: 'banner banner-stack', role: 'status' },
        el('span', {}, text),
        el('div', { class: 'banner-actions' },
          el('a', { class: 'link-btn', href: '#/year/' + sb.year + '/settle' }, '저금통 연말 결산하기'),
          el('button', {
            type: 'button', class: 'link-btn',
            onclick: async () => { try { await hideSettleBanner(ctx.db, settleTodayStr()); } catch (err) { console.error(err); } settleBanner.remove(); },
          }, '나중에')));
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
    settleBanner, // SETTLE-BANNER-ENTRY
    stamps,
    backupBanner,
    el('div', { class: 'spacer' }),
    // 엄지가 닿는 아래쪽에 큰 버튼 두 개. 안내 줄이 많아도 첫 화면에서 가려지지 않게 아래 메뉴 바로 위에 붙여 둔다 (2026-11-04)
    el('div', { class: 'home-actions' },
      el('a', { class: 'btn primary', href: '#/write' }, '직접 쓰기'),
      el('a', { class: 'btn', href: '#/sms' }, '문자 붙여넣기')),
  );
}

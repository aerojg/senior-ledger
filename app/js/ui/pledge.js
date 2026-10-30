/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// S8 약속 - 한 달에 한 가지만 정하고 진행을 본다 (화면흐름 v1.1 S8, 말풀이틀 v1.0)
// 야단치는 말은 쓰지 않고, 신호는 글자와 모양을 함께 쓴다 (U5).
import { el } from './dom.js';
import { formatWon } from './format.js';
import { dbGetAll } from '../storage/db.js';
import { todayStr, periodKeyOf } from '../storage/dates.js';
import {
  getActivePledge, closeIfEnded, closePledge, createPledge, loadSuggestions,
  pledgeProgress, skipSuggestion, isSuggestionSkipped,
} from '../storage/pledges.js';

const LEVEL_LABEL = {
  ok: ['●', '잘 지키고 있어요'],
  near: ['▲', '한도에 가까워요'],
  over: ['■', '한도를 넘었어요'],
};

// 12만 원, 12만 3,400원 처럼 읽기 쉽게 쓴다
function manWon(n) {
  if (n < 10000) return formatWon(n);
  const man = Math.floor(n / 10000);
  const rest = n % 10000;
  return rest === 0 ? man + '만 원' : man + '만 ' + rest.toLocaleString('ko-KR') + '원';
}

function monthName(key) { return Number(key.split('-')[1]) + '월'; }

// ---- 진행 중인 약속 ----
function activeCard(pledge, pr, rerender, ctx) {
  const [shape, label] = LEVEL_LABEL[pr.level];
  const card = el('div', { class: 'card sig-' + (pr.level === 'ok' ? 'green' : pr.level === 'near' ? 'yellow' : 'red') },
    el('p', { class: 'kicker' }, monthName(pledge.periodKey) + ' 약속'),
    el('h2', { class: 'card-title' }, pledge.title + ' ' + manWon(pledge.limitValue) + ' 안에서'),
    el('p', { class: 'sig-line' }, el('span', { class: 'sig-shape', 'aria-hidden': 'true' }, shape), ' ' + label),
    el('div', { class: 'bar-track', 'aria-hidden': 'true' },
      el('div', { class: 'bar-fill', style: 'width:' + Math.max(2, pr.percent) + '%' })),
    el('div', { class: 'row' }, el('p', {}, '지금까지 쓴 돈'), el('p', { class: 'row-value' }, formatWon(pr.actual))),
    el('div', { class: 'row' },
      el('p', {}, pr.remaining >= 0 ? '남은 돈' : '넘은 돈'),
      el('p', { class: 'row-value' }, formatWon(Math.abs(pr.remaining)))),
    el('div', { class: 'row' }, el('p', {}, '남은 날'), el('p', { class: 'row-value' }, '오늘 포함 ' + pr.daysLeft + '일')),
    pr.level === 'over'
      ? el('p', { class: 'note' }, '괜찮아요. 이번 달 기록은 그대로 남기고, 다음 달에 다시 정해 봐요.')
      : el('p', { class: 'note' }, '평소 월 평균 ' + manWon(pledge.baselineValue) + '보다 조금 적게 쓰는 약속이에요.'));

  // 그만하기: 한 번 더 확인한 뒤에만 끝낸다
  const stopBox = el('div', { hidden: true },
    el('p', {}, '이 약속을 그만할까요? 기록은 그대로 남아요.'),
    el('button', {
      type: 'button', class: 'btn',
      onclick: async () => { await closePledge(ctx.db, pledge.id, 'ended'); await rerender(); },
    }, '네, 그만할게요'));
  const stopBtn = el('button', { type: 'button', class: 'btn', 'aria-expanded': 'false' }, '그만하기');
  stopBtn.addEventListener('click', () => {
    stopBox.hidden = !stopBox.hidden;
    stopBtn.setAttribute('aria-expanded', stopBox.hidden ? 'false' : 'true');
  });
  return [card, stopBtn, stopBox];
}

// ---- 끝난 약속의 결과 한 줄 ----
function resultCard(pledge) {
  const kept = pledge.status === 'kept';
  return el('div', { class: 'card' },
    el('p', { class: 'kicker' }, monthName(pledge.periodKey) + ' 약속 결과'),
    el('p', { class: 'sig-line' }, el('span', { class: 'sig-shape', 'aria-hidden': 'true' }, kept ? '●' : '▲'), ' ' + (kept ? '약속을 지켰어요' : '이번에는 한도를 넘었어요')),
    el('p', {}, kept ? pledge.title + ' 한도 ' + manWon(pledge.limitValue) + ' 안에서 마쳤어요. 잘하셨어요.'
                     : '괜찮아요. 다음 달에 다시 정해 봐요.'));
}

// ---- 새 약속 제안 ----
function suggestCard(sug, idx, total, nowKey, startDay, rerender, ctx, basedOnKey) {
  const s = sug[idx];
  const over = s.lastAmount - s.base;
  return el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, monthName(nowKey) + ' 약속 한 가지 정해 볼까요?'),
    el('p', { class: 'big-number' }, s.name + ' ' + manWon(s.limitValue)),
    el('p', {}, monthName(basedOnKey) + '에 ' + s.name + '이(가) 평소(월 평균 ' + manWon(s.base) + ')보다 ' + manWon(over) + ' 늘었어요.'),
    el('p', { class: 'note' }, '이번 달 한도를 ' + manWon(s.limitValue) + '으로 정하면 평소보다 조금 아낄 수 있어요.'),
    el('button', {
      type: 'button', class: 'btn primary',
      onclick: async () => {
        await createPledge(ctx.db, {
          categoryId: s.categoryId, title: s.name, limitValue: s.limitValue,
          baselineValue: s.base, periodKey: nowKey, startDay,
        });
        await rerender();
      },
    }, '이걸로 할게요'),
    total > 1 ? el('button', { type: 'button', class: 'btn', onclick: () => rerender((idx + 1) % total) }, '다른 걸로') : null,
    el('button', {
      type: 'button', class: 'btn',
      onclick: async () => { await skipSuggestion(ctx.db, nowKey); await rerender(0, false); },
    }, '이번엔 쉬어요'));
}

export async function pledgeView(ctx) {
  const startDay = ctx.settings.monthStartDay || 1;
  const nowKey = periodKeyOf(todayStr(), startDay);
  const section = el('section', {});

  async function build(idx = 0, force = false) {
    const out = [el('h1', {}, '약속')];
    let active = await getActivePledge(ctx.db);
    let justClosed = null;
    if (active) {
      const closed = await closeIfEnded(ctx.db, active, startDay, todayStr());
      if (closed.status !== 'active') { justClosed = closed; active = null; }
    }
    const rerender = async (i = 0, f = force) => section.replaceChildren(...await build(i, f));

    if (active) {
      const pr = await pledgeProgress(ctx.db, active, startDay, todayStr());
      out.push(...activeCard(active, pr, rerender, ctx));
    } else {
      if (justClosed) out.push(resultCard(justClosed));
      if (!force && await isSuggestionSkipped(ctx.db, nowKey)) {
        out.push(el('div', { class: 'card' },
          el('p', {}, '이번 달은 쉬기로 했어요. 마음이 바뀌면 언제든 정할 수 있어요.'),
          el('button', { type: 'button', class: 'btn', onclick: () => rerender(0, true) }, '그래도 정해 볼래요')));
      } else {
        const categories = await dbGetAll(ctx.db, 'categories');
        const r = await loadSuggestions(ctx.db, nowKey, startDay, categories);
        if (r.baselineMonths === 0) {
          out.push(el('div', { class: 'card' }, el('p', {}, '기록이 조금 더 쌓이면 약속을 제안해 드릴게요.')));
        } else if (r.suggestions.length === 0) {
          out.push(el('div', { class: 'card' }, el('p', {}, monthName(r.basedOnKey) + '에는 평소보다 눈에 띄게 늘어난 항목이 없어요. 지금처럼 하셔도 좋아요.')));
        } else {
          out.push(suggestCard(r.suggestions, idx % r.suggestions.length, r.suggestions.length, nowKey, startDay, rerender, ctx, r.basedOnKey));
        }
      }
    }
    out.push(el('a', { class: 'btn', href: '#/home' }, '홈으로'));
    return out;
  }

  section.replaceChildren(...await build());
  return section;
}

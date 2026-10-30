/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// S8 약속 - 한 달에 한 가지만 정하고 진행을 본다 (화면흐름 v1.1 S8, 말풀이틀 v1.0)
// 야단치는 말은 쓰지 않고, 신호는 글자와 모양을 함께 쓴다 (U5).
import { el } from './dom.js';
import { formatWon } from './format.js';
import { dbGetAll } from '../storage/db.js';
import { todayStr, periodKeyOf, shiftPeriodKey } from '../storage/dates.js';
import { listJars } from '../storage/jars.js';
import {
  getActivePledge, closeIfEnded, closePledge, createPledge, loadSuggestions,
  pledgeProgress, skipSuggestion, isSuggestionSkipped,
  getResult, listResults, listUnassigned, assignSavedToJar,
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

// 받침이 있으면 '이', 없으면 '가' (식비가, 교통비가, 외식이)
function iga(word) {
  const c = String(word).trim().slice(-1).charCodeAt(0);
  if (c >= 0xAC00 && c <= 0xD7A3) return (c - 0xAC00) % 28 === 0 ? '가' : '이';
  return '이';
}

// 말풀이틀 2번: 기준기간은 실제 쓴 달 수에 맞춘다
function baselineName(months) {
  return months >= 3 ? '최근 3개월' : months === 2 ? '최근 2개월' : '지난달';
}

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

// ---- 성적표 (끝난 약속) ----
// 아낀 돈 문장은 말풀이틀 2번의 틀을 그대로 쓰고, [기준 보기]를 항상 둔다 (숨은 동작 금지).
function gradeCard(res) {
  const kept = res.result === 'kept';
  const card = el('div', { class: 'card' },
    el('p', { class: 'kicker' }, monthName(res.periodKey) + ' 약속 성적표'),
    el('p', { class: 'sig-line' }, el('span', { class: 'sig-shape', 'aria-hidden': 'true' }, kept ? '●' : '▲'), ' ' + (kept ? '약속을 지켰어요' : '이번에는 한도를 넘었어요')),
    el('p', {}, kept
      ? res.title + ' 한도 ' + manWon(res.limitValue) + ' 안에서 마쳤어요(쓴 돈 ' + manWon(res.actualValue) + '). 잘하셨어요.'
      : '쓴 돈은 ' + manWon(res.actualValue) + '이었어요. 괜찮아요. 다음 달에 다시 정해 봐요.'));
  if (kept && res.savedAmount > 0) {
    const basis = el('div', { class: 'card basis', hidden: true },
      el('p', {}, '비교한 기간: ' + baselineName(res.baselineMonths)),
      el('p', { class: 'note' }, '필수 지출, 일회성 지출, 응원 소비는 평소 계산에서 뺐어요.'));
    const btn = el('button', { type: 'button', class: 'btn', 'aria-expanded': 'false' }, '기준 보기');
    btn.addEventListener('click', () => {
      basis.hidden = !basis.hidden;
      btn.setAttribute('aria-expanded', basis.hidden ? 'false' : 'true');
    });
    card.append(
      el('p', { class: 'big-number' }, manWon(res.savedAmount) + ' 아꼈어요'),
      el('p', {}, res.title + ': ' + baselineName(res.baselineMonths) + ' 평균(' + manWon(res.baselineValue) + ')보다 ' + manWon(res.savedAmount) + ' 아꼈어요'),
      btn, basis);
  }
  return card;
}

// ---- "이 돈, 어디에 모을까요?" ----
function whereCard(res, jars, onChoose, onLater) {
  const card = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '이 돈, 어디에 모을까요?'),
    el('p', { class: 'big-number' }, manWon(res.savedAmount)),
    el('p', { class: 'note' }, '저금통은 계산해 두는 곳이에요. 실제 돈은 통장에서 직접 옮기신 뒤 [옮겼어요]로 적어 주세요.'));
  if (jars.length === 0) {
    card.append(el('p', {}, '아직 저금통 칸이 없어요. 칸을 만들면 여기에 담을 수 있어요.'),
      el('a', { class: 'btn primary', href: '#/jar/new' }, '칸 만들러 가기'));
  } else {
    for (const j of jars) {
      card.append(el('button', { type: 'button', class: 'btn primary', onclick: () => onChoose(j) }, j.name + ' 칸에 담기'));
    }
  }
  card.append(el('button', { type: 'button', class: 'btn', onclick: onLater }, '나중에 정할게요'));
  return card;
}

// ---- 새 약속 제안 ----
function suggestCard(sug, idx, total, nowKey, startDay, rerender, ctx, basedOnKey, baselineMonths) {
  const s = sug[idx];
  const over = s.lastAmount - s.base;
  return el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, monthName(nowKey) + ' 약속 한 가지 정해 볼까요?'),
    el('p', { class: 'big-number' }, s.name + ' ' + manWon(s.limitValue)),
    el('p', {}, monthName(basedOnKey) + '에 ' + s.name + iga(s.name) + ' 평소(월 평균 ' + manWon(s.base) + ')보다 ' + manWon(over) + ' 늘었어요.'),
    el('p', { class: 'note' }, '이번 달 한도를 ' + manWon(s.limitValue) + '으로 정하면 평소보다 조금 아낄 수 있어요.'),
    el('button', {
      type: 'button', class: 'btn primary',
      onclick: async () => {
        await createPledge(ctx.db, {
          categoryId: s.categoryId, title: s.name, limitValue: s.limitValue,
          baselineValue: s.base, baselineMonths, periodKey: nowKey, startDay,
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
  const later = new Set();       // "나중에 정할게요"를 누른 성적표 (이 화면을 보는 동안만)
  let notice = null;             // 방금 칸에 담았다는 안내

  async function build(idx = 0, force = false) {
    const out = [el('h1', {}, '약속')];
    let active = await getActivePledge(ctx.db);
    let justClosed = null;
    if (active) {
      const closed = await closeIfEnded(ctx.db, active, startDay, todayStr());
      if (closed.status !== 'active') { justClosed = closed; active = null; }
    }
    const rerender = async (i = 0, f = force) => section.replaceChildren(...await build(i, f));

    if (notice) {
      out.push(el('div', { class: 'card', role: 'status' },
        el('p', {}, notice.jarName + ' 칸에 ' + manWon(notice.amount) + '을 담았어요(계산).'),
        el('a', { class: 'btn', href: '#/jar' }, '저금통 보기')));
      notice = null;
    }

    if (active) {
      const pr = await pledgeProgress(ctx.db, active, startDay, todayStr());
      out.push(...activeCard(active, pr, rerender, ctx));
    } else {
      // 성적표: 아직 칸을 정하지 않은 아낀 돈이 먼저, 없으면 방금 끝난 약속의 성적표
      const pending = (await listUnassigned(ctx.db)).filter((r) => !later.has(r.id));
      // 정하지 않은 돈이 없으면 방금 끝난 약속, 그것도 아니면 지난달 이후의 가장 최근 성적표를 계속 보여 준다
      let shown = pending[0] || (justClosed ? await getResult(ctx.db, justClosed.id) : null);
      if (!shown) {
        const latest = (await listResults(ctx.db))[0];
        if (latest && latest.periodKey >= shiftPeriodKey(nowKey, -1)) shown = latest;
      }
      if (shown) {
        out.push(gradeCard(shown));
        if (shown.savedAmount > 0 && !shown.assignedJarId && !later.has(shown.id)) {
          out.push(whereCard(shown, await listJars(ctx.db),
            async (jar) => {
              await assignSavedToJar(ctx.db, shown.id, jar.id, todayStr());
              notice = { jarName: jar.name, amount: shown.savedAmount };
              await rerender();
            },
            async () => { later.add(shown.id); await rerender(); }));
        }
      }
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
          out.push(suggestCard(r.suggestions, idx % r.suggestions.length, r.suggestions.length, nowKey, startDay, rerender, ctx, r.basedOnKey, r.baselineMonths));
        }
      }
    }
    out.push(el('a', { class: 'btn', href: '#/home' }, '홈으로'));
    return out;
  }

  section.replaceChildren(...await build());
  return section;
}

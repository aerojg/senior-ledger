/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// S7 결산 - 월 결산 한 장 (화면흐름 v1.1 S7, 말풀이틀 v1.0)
// 월 중에는 신호등을 칠하지 않고 "지금까지"의 금액과 순위만 보인다 (D42).
// 신호는 글자와 모양을 함께 쓰고 색만으로 구분하지 않는다 (U5).
import { el } from './dom.js';
import { formatWon } from './format.js';
import { dbGetAll } from '../storage/db.js';
import { todayStr, periodKeyOf, periodRange, shiftPeriodKey } from '../storage/dates.js';
import { listTransactionsByPeriod } from '../storage/transactions.js';
import { summarizeMonth, buildBaseline, balanceSignal, categorySignal, risingItems, buildPeriodTable, mergeCategories, buildRetire, buildJarYear, buildYearCompare } from '../analysis/month.js';
import { movedByKind } from '../storage/jars.js';
import { saveSetting } from './settings.js';
import { getYearReview, saveYearReview } from '../storage/yearReview.js';
import { isSettleOpen, settleWindow, getYearSettlement, planYearSettle, runYearSettle, undoYearSettle, refundTotalOf } from '../storage/yearSettle.js';

// 정산 가능 기간 판단에 쓰는 오늘. 시험할 때만 브라우저 콘솔에서 window.__GB_TODAY__ = '2027-01-05' 로 바꿀 수 있다.
const settleToday = () => (typeof window !== 'undefined' && window.__GB_TODAY__) || todayStr();
import { pickPhrase } from '../content/phrases.js';

const BALANCE_LABEL = {
  green: ['●', '여유 있어요'],
  yellow: ['▲', '빠듯해요'],
  red: ['■', '수입보다 더 썼어요'],
};
const CATEGORY_LABEL = {
  green: ['●', '평소보다 적어요'],
  yellow: ['▲', '조금 늘었어요'],
  red: ['■', '많이 늘었어요'],
};

// 12만 원, 12만 3,400원 처럼 읽기 쉽게 쓴다
function manWon(n) {
  if (n < 10000) return formatWon(n);
  const man = Math.floor(n / 10000);
  const rest = n % 10000;
  return rest === 0 ? man + '만 원' : man + '만 ' + rest.toLocaleString('ko-KR') + '원';
}

function baselineName(months) {
  return months >= 3 ? '최근 3개월' : months === 2 ? '최근 2개월' : '지난달';
}

function monthNumber(key) { return Number(key.split('-')[1]); }
function periodTitle(key) {
  const [y, m] = key.split('-');
  return y + '년 ' + Number(m) + '월';
}

const FOREST_MONTHS = 6;

// 위쪽 공통 머리: 제목, 달 이동, [나무]/[숲] 전환
function headParts(key, nowKey) {
  const sub = '';
  const nav = el('div', { class: 'month-nav' },
    el('a', { class: 'btn', href: '#/settle/' + shiftPeriodKey(key, -1) + sub }, '◀ 이전 달'),
    key < nowKey
      ? el('a', { class: 'btn', href: '#/settle/' + shiftPeriodKey(key, 1) + sub }, '다음 달 ▶')
      : el('span', { class: 'btn disabled', 'aria-disabled': 'true' }, '다음 달 ▶'));
  const pick = el('div', { class: 'month-nav' },
    el('a', { class: 'btn', href: '#/period' }, '기간 선택'),
    el('a', { class: 'btn', href: '#/year' }, '연간 결산'));
  return [el('h1', {}, '결산'), el('h2', { class: 'period' }, periodTitle(key)), nav, pick];
}

function resolveKey(ctx, params) {
  const startDay = ctx.settings.monthStartDay || 1;
  const nowKey = periodKeyOf(todayStr(), startDay);
  let key = /^\d{4}-\d{2}$/.test(params.key || '') ? params.key : nowKey;
  if (key > nowKey) key = nowKey;
  return { startDay, nowKey, key };
}

const kdate = (d) => { const [y, m, dd] = d.split('-').map(Number); return y + '년 ' + m + '월 ' + dd + '일'; };

// 저금통 카드 아래의 정산 안내: 정산했으면 결과 보기, 정산 기간이면 [연말 정산하기], 아니면 가능한 기간 안내
async function settleArea(ctx, year, jy) {
  if (!jy.rows.some((r) => r.diff !== 0)) return [];
  const done = await getYearSettlement(ctx.db, year);
  const link = (label, primary) => el('a', { class: 'btn' + (primary ? ' primary' : ''), href: '#/year/' + year + '/settle' }, label);
  if (done) return [el('p', { class: 'note' }, year + '년 저금통 정산을 마쳤어요.'), link('정산 내용 보기', false)];
  if (isSettleOpen(year, settleToday())) return [link('연말 정산하기', true)];
  const w = settleWindow(year);
  return [el('p', { class: 'note' }, '연말 정산은 ' + kdate(w.start) + '부터 ' + kdate(w.end) + '까지 할 수 있어요.')];
}

// 연말 정산 화면: 어떻게 되는지 보여 주고 [정산하기]. 정산한 뒤에는 결과와 [정산 취소하기]
export async function yearSettleView(ctx, path, params) {
  const { nowKey } = resolveKey(ctx, {});
  const nowYear = Number(nowKey.split('-')[0]);
  let year = Number(params.y);
  if (!Number.isInteger(year) || year < 2000 || year > nowYear) year = nowYear;
  const box = el('section', {});
  const back = el('a', { class: 'btn', href: '#/year/' + year }, '연간 결산으로');
  const paint = async (message) => {
    const done = await getYearSettlement(ctx.db, year);
    const kids = [el('h1', {}, year + '년 저금통 정산')];
    if (message) kids.push(el('div', { class: 'alert', role: 'alert' }, message));
    if (done) {
      kids.push(el('div', { class: 'card' },
        el('p', {}, '정산을 마쳤어요. 칸은 ' + (year + 1) + '년 0원에서 다시 시작해요.'),
        done.items.map((it) => el('div', { class: 'row stack' },
          el('p', { class: 'kicker' }, it.name),
          el('p', {}, it.diff < 0 ? '먼저 쓴 돈 ' + formatWon(-it.diff) + '을 ' + year + '년 12월 31일 쓴 돈(기타)으로 확정했어요.' : '남은 돈 ' + formatWon(it.diff) + '을 정리했어요. ' + year + '년 쓴 돈에서 뺐어요.')))));
      const undo = el('button', { type: 'button', class: 'btn' }, '정산 취소하기');
      undo.addEventListener('click', async () => {
        undo.disabled = true;
        try { await undoYearSettle(ctx.db, year); await paint('정산을 취소했어요.'); }
        catch (e) { console.error(e); undo.disabled = false; await paint(e.userMessage || '취소하지 못했어요. 한 번 더 눌러 주세요.'); }
      });
      kids.push(undo);
    } else {
      const plan = await planYearSettle(ctx.db, year);
      const open = isSettleOpen(year, settleToday());
      if (plan.rows.length === 0) {
        kids.push(el('div', { class: 'card' }, el('p', {}, '정산할 돈이 없어요.')));
      } else {
        kids.push(el('div', { class: 'card' },
          el('h2', { class: 'card-title' }, '정산하면 이렇게 돼요'),
          plan.rows.map((r) => el('div', { class: 'row stack' },
            el('p', { class: 'kicker' }, r.name),
            el('p', {}, r.diff < 0
              ? '▲ 먼저 쓴 돈 ' + formatWon(-r.diff) + ' → ' + year + '년 12월 31일 쓴 돈(기타)으로 확정하고, 칸은 0원이 돼요.'
              : '● 남은 돈 ' + formatWon(r.diff) + ' → ' + year + '년 쓴 돈에서 빼고, 칸은 0원이 돼요.'))),
          el('p', { class: 'note' }, '남은 돈 모음은 정산하지 않고 새해에도 이어 가요. 월 결산 숫자는 바뀌지 않고, 연간 결산의 쓴 돈에서만 되돌린 돈을 빼요. 정산한 뒤에도 [정산 취소하기]로 되돌릴 수 있어요. 이 앱은 실제 돈을 보관하지 않아요.')));
        if (open) {
          const go = el('button', { type: 'button', class: 'btn primary' }, '정산하기');
          go.addEventListener('click', async () => {
            go.disabled = true;
            try { await runYearSettle(ctx.db, year, settleToday()); await paint(); }
            catch (e) { console.error(e); go.disabled = false; await paint(e.userMessage || '정산하지 못했어요. 한 번 더 눌러 주세요.'); }
          });
          kids.push(go);
        } else {
          const w = settleWindow(year);
          kids.push(el('div', { class: 'card' }, el('p', {}, '아직 정산할 수 없어요. ' + kdate(w.start) + '부터 ' + kdate(w.end) + '까지 할 수 있어요.')));
        }
      }
    }
    kids.push(back, el('a', { class: 'btn', href: '#/home' }, '홈으로'));
    box.replaceChildren(...kids);
    window.scrollTo(0, 0);
  };
  await paint();
  return box;
}

// 연간 결산 1단계: 한 해의 돈 흐름과 많이 쓴 분류 순위
export async function yearView(ctx, path, params) {
  const { startDay, nowKey } = resolveKey(ctx, {});
  const nowYear = Number(nowKey.split('-')[0]);
  const nowM = monthNumber(nowKey);
  let year = Number(params.y);
  if (!Number.isInteger(year) || year < 2000 || year > nowYear) year = nowYear;
  const lastM = year === nowYear ? nowM : 12;
  const mk = (m) => year + '-' + String(m).padStart(2, '0');

  const categories = await dbGetAll(ctx.db, 'categories');
  const list = [];
  for (let m = 1; m <= lastM; m++) {
    list.push({ key: mk(m), summary: summarizeMonth(await listTransactionsByPeriod(ctx.db, mk(m), startDay), categories) });
  }
  const t = buildPeriodTable(list);

  const nav = el('div', { class: 'month-nav' },
    el('a', { class: 'btn', href: '#/year/' + (year - 1) }, '◀ 이전 해'),
    year < nowYear
      ? el('a', { class: 'btn', href: '#/year/' + (year + 1) }, '다음 해 ▶')
      : el('span', { class: 'btn disabled', 'aria-disabled': 'true' }, '다음 해 ▶'));
  const head = [el('h1', {}, '연간 결산'), el('h2', { class: 'period' }, year + '년'), nav];
  const foot = [year === nowYear ? el('a', { class: 'btn primary', href: '#/retire' }, '은퇴 후 생활비 환산') : null,
    el('a', { class: 'btn', href: '#/settle' }, '결산으로'), el('a', { class: 'btn', href: '#/home' }, '홈으로')];

  if (t.total.months === 0) {
    return el('section', {}, ...head, el('div', { class: 'card' }, el('p', {}, year + '년에는 기록이 없어요.')), ...foot);
  }

  const running = year === nowYear && settleToday() <= year + '-12-31';
  const refund = await refundTotalOf(ctx.db, year);          // 연말 정산에서 되돌린 돈: 연간 쓴 돈에서만 뺀다
  const spent = t.total.expense - refund;
  const avg = t.total.months ? Math.round(spent / t.total.months) : 0;
  const balance = t.total.balance + refund;
  const flow = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, year + '년 돈 흐름'),
    el('p', { class: 'kicker' }, running ? '지금까지 쓴 돈' : '1년 동안 쓴 돈'),
    el('p', { class: 'big-number' }, formatWon(spent)),
    refund > 0 ? el('p', { class: 'note' }, '저금통 연말 정산에서 되돌린 ' + formatWon(refund) + '을 뺀 금액이에요. 아래 달마다 막대와 분류 순위는 되돌리기 전 금액이에요.') : null,
    el('div', { class: 'row' }, el('p', {}, '한 달 평균'), el('p', { class: 'row-value' }, formatWon(avg))),
    t.total.income > 0 ? el('div', { class: 'row' }, el('p', {}, '들어온 돈'), el('p', { class: 'row-value' }, formatWon(t.total.income))) : el('p', { class: 'note' }, '수입을 기록하면 남은 돈도 알 수 있어요.'),
    t.total.balanceMonths > 0 ? el('div', { class: 'row' }, el('p', {}, balance >= 0 ? '남은 돈' : '모자란 돈'), el('p', { class: 'row-value' }, formatWon(Math.abs(balance)))) : null,
    t.total.balanceMonths > 0 && t.total.balanceMonths < t.total.months ? el('p', { class: 'note' }, '남은 돈은 수입을 적은 달(' + t.total.balanceMonths + '개월)만 계산했어요.') : null,
    running ? el('p', { class: 'note' }, year + '년은 아직 지나는 중이라 연말까지 달라질 수 있어요.') : null);

  const used = t.rows.filter((r) => r.hasData);
  const maxE = Math.max(1, ...used.map((r) => r.expense));
  const bars = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '달마다 쓴 돈'),
    used.map((r) => el('div', { class: 'bar-row' },
      el('div', { class: 'row' }, el('p', { class: 'bar-name' }, monthNumber(r.key) + '월'), el('p', { class: 'row-value' }, formatWon(r.expense))),
      el('div', { class: 'bar-track', 'aria-hidden': 'true' },
        el('div', { class: 'bar-fill', style: 'width:' + Math.max(2, Math.round(r.expense * 100 / maxE)) + '%' })))),
    used.length < t.rows.length ? el('p', { class: 'note' }, '기록 없는 달은 보이지 않아요.') : null);

  const cats = mergeCategories(list.map((x) => x.summary));
  const top = cats.slice(0, 5);
  const restSum = cats.slice(5).reduce((a, g) => a + g.amount, 0);
  const maxC = top.length ? top[0].amount : 1;
  const cbar = (name, amount) => el('div', { class: 'bar-row' },
    el('div', { class: 'row' }, el('p', { class: 'bar-name' }, name), el('p', { class: 'row-value' }, formatWon(amount))),
    el('div', { class: 'bar-track', 'aria-hidden': 'true' },
      el('div', { class: 'bar-fill', style: 'width:' + Math.max(2, Math.round(amount * 100 / maxC)) + '%' })));
  const rank = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, year + '년 어디에 많이 썼나요'),
    top.length === 0 ? el('p', { class: 'meta' }, '쓴 돈 기록이 없어요.') : null,
    top.map((g, i) => cbar((i + 1) + '위 ' + g.name, g.amount)),
    cats.length > 5 ? cbar('나머지 ' + (cats.length - 5) + '개 분류', restSum) : null);

  // ---- 저금통 정산 보기 (미리 모으는 칸의 한 해 적립·집행·차이, 보기만 한다, D114) ----
  const jy = buildJarYear(await dbGetAll(ctx.db, 'jars'), await dbGetAll(ctx.db, 'jarEntries'), year);
  const jarCard = jy.rows.length === 0 ? null : el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, year + '년 저금통 (미리 모으는 칸)'),
    jy.rows.map((r) => el('div', { class: 'row stack' },
      el('p', { class: 'kicker' }, r.name + (r.done ? ' (끝난 칸)' : '')),
      el('div', { class: 'row' }, el('p', {}, '모은 돈'), el('p', { class: 'row-value' }, formatWon(r.moved))),
      el('div', { class: 'row' }, el('p', {}, '쓴 돈'), el('p', { class: 'row-value' }, formatWon(r.used))),
      el('div', { class: 'row' },
        el('p', {}, r.diff < 0 ? '▲ 먼저 쓴 돈' : r.diff > 0 ? '● 남은 돈' : '■ 딱 맞아요'),
        el('p', { class: 'row-value' }, formatWon(Math.abs(r.diff)))))),
    el('p', { class: 'note' }, '남은 돈은 연말 정산 때 정리할 돈이고, 먼저 쓴 돈은 올해 안에 저금해서 채워야 하는 돈이에요. 이 앱은 실제 돈을 보관하지 않아요.'),
    ...(await settleArea(ctx, year, jy)));

  // ---- 이 해 결과 저장과 지난해 비교 (해가 끝난 뒤 저장, 2년째부터 비교, D114) ----
  const snapshot = {
    months: t.total.months, expense: spent, avg, income: t.total.income,
    balance: t.total.balanceMonths > 0 ? balance : null, refund,
    cats: cats.map((g) => ({ id: g.id, name: g.name, amount: g.amount })),
    jars: jy.rows.map((r) => ({ name: r.name, moved: r.moved, used: r.used, diff: r.diff })),
  };
  const yearOver = settleToday() > year + '-12-31';
  const saved = await getYearReview(ctx.db, year);
  const saveBox = el('div', { class: 'card' }, el('h2', { class: 'card-title' }, year + '년 결과 저장'));
  const savedText = () => saved && saved.snapshot
    ? year + '년 결과를 ' + kdate(saved.savedOn || year + '-12-31') + '에 저장했어요. 저장한 숫자는 기록을 고쳐도 바뀌지 않아요.'
    : null;
  if (!yearOver) {
    saveBox.append(el('p', { class: 'note' }, year + '년이 끝나면 여기서 결과를 저장하고, 다음 해에 비교할 수 있어요.'));
  } else {
    const msg = el('p', { class: 'note' });
    msg.textContent = savedText() || '아직 저장하지 않았어요. 저장하면 다음 해에 이 해와 비교해서 보여 드려요.';
    const btn = el('button', { type: 'button', class: 'btn primary' }, saved ? '다시 저장하기' : '이 해 결과 저장');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const rec = await saveYearReview(ctx.db, year, snapshot, settleToday());
        msg.textContent = year + '년 결과를 저장했어요. (' + kdate(rec.savedOn) + ')';
        btn.textContent = '다시 저장하기';
      } catch (e) {
        console.error(e);
        msg.textContent = '저장하지 못했어요. 한 번 더 눌러 주세요.';
      }
      btn.disabled = false;
    });
    saveBox.append(msg, btn);
  }

  const prevRec = await getYearReview(ctx.db, year - 1);
  let compareCard = null;
  if (prevRec && prevRec.snapshot) {
    const c = buildYearCompare(prevRec.snapshot, snapshot);
    const word = (tr, diff) => tr === 'same' ? '비슷해요' : tr === 'more' ? formatWon(Math.abs(diff)) + ' 더 많아요' : formatWon(Math.abs(diff)) + ' 더 적어요';
    const mark = (tr) => (tr === 'more' ? '▲' : tr === 'less' ? '▼' : '■');
    compareCard = el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, (year - 1) + '년과 비교'),
      el('p', {}, year + '년 쓴 돈은 ' + (year - 1) + '년보다 ' + word(c.expenseTrend, c.expenseDiff) + '.'),
      el('p', {}, '한 달 평균은 ' + formatWon(prevRec.snapshot.avg) + '에서 ' + formatWon(avg) + '으로, ' + word(c.avgTrend, c.avgDiff) + '.'),
      el('p', { class: 'kicker' }, '많이 쓴 분류'),
      c.cats.map((g) => el('div', { class: 'row stack' },
        el('p', { class: 'bar-name' }, g.name),
        el('p', { class: 'meta' }, (year - 1) + '년 ' + formatWon(g.prev) + ' → ' + year + '년 ' + formatWon(g.now)),
        el('p', { class: 'row-value' }, mark(g.trend) + ' ' + (g.trend === 'same' ? '비슷해요' : formatWon(Math.abs(g.diff)) + (g.trend === 'more' ? ' 늘었어요' : ' 줄었어요'))))),
      running ? el('p', { class: 'note' }, year + '년은 아직 지나는 중이라 연말까지 달라질 수 있어요.') : null,
      el('p', { class: 'note' }, '저장해 둔 ' + (year - 1) + '년 숫자와 견준 단순 계산이에요.'));
  }

  return el('section', {}, ...head, flow, bars, rank, jarCard, compareCard, saveBox,
    el('p', { class: 'note' }, '단순 계산 기준이며 투자·금융 자문이 아니에요.'), ...foot);
}

// S10 은퇴 후 생활비 환산 (연간 결산 2단계): 올해 생활비 평균 + 늘어날 돈 - 줄어들 돈
const RETIRE_STEP = 100000;
const RETIRE_MAX = 100000000;
export async function retireView(ctx) {
  const { startDay, nowKey } = resolveKey(ctx, {});
  const year = nowKey.split('-')[0];
  const categories = await dbGetAll(ctx.db, 'categories');
  const list = [];
  for (let m = 1; m <= monthNumber(nowKey); m++) {
    const k = year + '-' + String(m).padStart(2, '0');
    list.push({ key: k, summary: summarizeMonth(await listTransactionsByPeriod(ctx.db, k, startDay), categories) });
  }
  const saved = ctx.settings.retirement || {};
  const st = { up: Number(saved.up) || 0, down: Number(saved.down) || 0 };
  const foot = [el('a', { class: 'btn', href: '#/year' }, '연간 결산으로'), el('a', { class: 'btn', href: '#/home' }, '홈으로')];
  const first = buildRetire(list);
  const anySpent = list.some((x) => x.summary.expense > 0);
  if (first.months === 0) {
    return el('section', {}, el('h1', {}, '은퇴 후 생활비'),
      el('div', { class: 'card' },
        el('p', {}, anySpent
          ? '올해 쓴 돈이 모두 일회성 지출이거나 미리 모으는 돈이라서, 생활비로 셀 수 있는 기록이 아직 없어요.'
          : '올해 쓴 돈 기록이 아직 없어서 계산할 수 없어요. 기록이 쌓이면 다시 와 주세요.'),
        anySpent ? el('p', { class: 'note' }, '매달 쓰는 식비·생활비 같은 기록이 쌓이면 계산해 드려요.') : null), ...foot);
  }

  const baseNote = el('p', { class: 'note' }, '일회성 지출(한 번 크게 쓴 돈)과 미리 모으는 돈은 뺀 금액이에요. 기록이 있는 ' + first.months + '개월 평균이에요.');
  const baseCard = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '1. 올해 한 달 생활비'),
    el('p', { class: 'big-number' }, formatWon(first.base)), baseNote);

  const resultNums = {
    monthly: el('p', { class: 'big-number' }), yearly: el('p', { class: 'row-value' }),
    five: el('p', { class: 'row-value' }), ten: el('p', { class: 'row-value' }),
  };
  const refresh = () => {
    const r = buildRetire(list, st.up, st.down);
    resultNums.monthly.textContent = formatWon(r.monthly);
    resultNums.yearly.textContent = formatWon(r.yearly);
    resultNums.five.textContent = formatWon(r.five);
    resultNums.ten.textContent = formatWon(r.ten);
  };

  const adjuster = (title, hint, field, word) => {
    const val = el('p', { class: 'big-number' });
    const show = () => { val.textContent = formatWon(st[field]); };
    const change = async (delta) => {
      st[field] = Math.min(RETIRE_MAX, Math.max(0, st[field] + delta));
      show(); refresh();
      await saveSetting(ctx, { retirement: { up: st.up, down: st.down } });
    };
    const less = el('button', { type: 'button', class: 'btn' }, '10만 원 줄이기');
    const more = el('button', { type: 'button', class: 'btn' }, '10만 원 늘리기');
    less.addEventListener('click', () => change(-RETIRE_STEP));
    more.addEventListener('click', () => change(RETIRE_STEP));
    show();
    return el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, title), el('p', { class: 'meta' }, hint), val,
      el('div', { class: 'month-nav' }, less, more),
      el('p', { class: 'note' }, '한 번 누를 때마다 한 달에 ' + word + ' 돈이 10만 원씩 바뀌어요. 바꾼 값은 저절로 저장돼요.'));
  };
  const upCard = adjuster('2. 은퇴 후 더 들 돈 (한 달)', '예: 여행, 가족 지원, 취미, 병원', 'up', '더 드는');
  const downCard = adjuster('3. 은퇴 후 덜 들 돈 (한 달)', '예: 출퇴근 교통비, 직장 점심값, 직장 관련 옷', 'down', '덜 드는');

  refresh();
  const result = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '4. 은퇴 후 생활비 (예상)'),
    el('p', { class: 'kicker' }, '한 달'), resultNums.monthly,
    el('div', { class: 'row' }, el('p', {}, '1년'), resultNums.yearly),
    el('div', { class: 'row' }, el('p', {}, '5년'), resultNums.five),
    el('div', { class: 'row' }, el('p', {}, '10년'), resultNums.ten),
    el('p', { class: 'note' }, '올해 생활비에 2번을 더하고 3번을 뺀 단순 계산이에요. 물가 오름이나 이자, 세금은 넣지 않았어요. 투자·금융 자문이 아니에요.'));

  return el('section', {}, el('h1', {}, '은퇴 후 생활비'), baseCard, upCard, downCard, result, ...foot);
}

// 기간 선택: 올해의 시작 월~끝나는 월을 고르면 달마다 표와 누적을 보여 준다
const toWon = (n) => n.toLocaleString('ko-KR');
export async function periodView(ctx, path, params) {
  const { startDay, nowKey } = resolveKey(ctx, {});
  const year = nowKey.split('-')[0];
  const nowM = monthNumber(nowKey);
  const clamp = (v, d) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= nowM ? n : d; };
  let from = clamp(params.from, 1);
  let to = clamp(params.to, nowM);
  if (from > to) to = from;
  const mk = (m) => year + '-' + String(m).padStart(2, '0');

  const categories = await dbGetAll(ctx.db, 'categories');
  const list = [];
  for (let m = from; m <= to; m++) {
    list.push({ key: mk(m), summary: summarizeMonth(await listTransactionsByPeriod(ctx.db, mk(m), startDay), categories) });
  }
  const t = buildPeriodTable(list);

  const go = (f, e) => { location.hash = '#/period/' + f + '/' + Math.max(f, e); };
  const opts = (sel) => Array.from({ length: nowM }, (_, i) => el('option', { value: String(i + 1), selected: i + 1 === sel ? true : null }, (i + 1) + '월'));
  const selFrom = el('select', { class: 'input', id: 'pFrom', 'aria-label': '시작 월' }, opts(from));
  const selTo = el('select', { class: 'input', id: 'pTo', 'aria-label': '끝나는 월' }, opts(to));
  selFrom.addEventListener('change', () => go(Number(selFrom.value), to));
  selTo.addEventListener('change', () => go(from, Number(selTo.value)));
  const pickCard = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, year + '년 기간 고르기'),
    el('label', { class: 'label', for: 'pFrom' }, '시작 월'), selFrom,
    el('label', { class: 'label', for: 'pTo' }, '끝나는 월'), selTo,
    el('p', { class: 'note' }, '올해 안에서 고를 수 있어요. 고르면 아래 표가 바로 바뀌어요.'));

  if (t.total.months === 0) {
    return el('section', {}, el('h1', {}, '기간 선택'), pickCard,
      el('div', { class: 'card' }, el('p', {}, '고른 기간에 기록이 없어요.')),
      el('a', { class: 'btn', href: '#/settle' }, '결산으로'));
  }

  // 기록 없는 달이 이어지면 한 줄로 합친다
  const tableRows = (rows) => {
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.hasData) {
        let j = i;
        while (j + 1 < rows.length && !rows[j + 1].hasData) j++;
        const label = j > i ? monthNumber(r.key) + '월~' + monthNumber(rows[j].key) + '월' : monthNumber(r.key) + '월';
        out.push(el('tr', {}, el('th', { scope: 'row' }, label), el('td', { colspan: '3', class: 'none' }, '기록 없음')));
        i = j;
        continue;
      }
      out.push(el('tr', {},
        el('th', { scope: 'row' }, monthNumber(r.key) + '월'),
        el('td', {}, toWon(r.expense), el('span', { class: 'sub' }, '누적 ' + toWon(r.cumExpense))),
        el('td', {}, r.income > 0 ? toWon(r.income) : '-'),
        el('td', {}, r.balance == null ? '-' : (r.balance < 0 ? '▼ ' : '') + toWon(Math.abs(r.balance)))));
    }
    return out;
  };
  const th = (txt) => el('th', { scope: 'col' }, txt);
  const table = el('table', { class: 'ptable' },
    el('caption', {}, from + '월 ~ ' + to + '월 (단위: 원)'),
    el('thead', {}, el('tr', {}, th('월'), th('쓴 돈'), th('들어온 돈'), th('남은 돈'))),
    el('tbody', {}, tableRows(t.rows)),
    el('tfoot', {}, el('tr', {},
      el('th', { scope: 'row' }, '합계'),
      el('td', {}, toWon(t.total.expense)),
      el('td', {}, t.total.income > 0 ? toWon(t.total.income) : '-'),
      el('td', {}, t.total.balanceMonths > 0 ? (t.total.balance < 0 ? '▼ ' : '') + toWon(Math.abs(t.total.balance)) : '-'))));

  const sum = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, from + '월부터 ' + to + '월까지'),
    el('p', { class: 'kicker' }, '쓴 돈 누적'),
    el('p', { class: 'big-number' }, formatWon(t.total.expense)),
    el('div', { class: 'row' }, el('p', {}, '한 달 평균'), el('p', { class: 'row-value' }, formatWon(t.total.avgExpense))),
    t.total.income > 0 ? el('div', { class: 'row' }, el('p', {}, '들어온 돈 누적'), el('p', { class: 'row-value' }, formatWon(t.total.income))) : null,
    t.total.balanceMonths > 0 ? el('div', { class: 'row' }, el('p', {}, t.total.balance >= 0 ? '남은 돈 누적' : '모자란 돈 누적'), el('p', { class: 'row-value' }, formatWon(Math.abs(t.total.balance)))) : null,
    t.total.balanceMonths > 0 && t.total.balanceMonths < t.total.months ? el('p', { class: 'note' }, '남은 돈은 수입을 적은 달(' + t.total.balanceMonths + '개월)만 계산했어요.') : null,
    t.total.months < t.rows.length ? el('p', { class: 'note' }, '기록 없는 달은 합계와 평균에 넣지 않았어요.') : null,
    el('p', { class: 'note' }, '▼ 표시는 수입보다 더 쓴 달이에요.'));

  return el('section', {}, el('h1', {}, '기간 선택'), pickCard, el('div', { class: 'card' }, table), sum,
    el('p', { class: 'note' }, '단순 계산 기준이며 투자·금융 자문이 아니에요.'),
    el('a', { class: 'btn', href: '#/settle' }, '결산으로'),
    el('a', { class: 'btn', href: '#/home' }, '홈으로'));
}

export async function settleView(ctx, path, params) {
  const { startDay, nowKey, key } = resolveKey(ctx, params);
  const ended = key < nowKey;                          // 끝난 달에서만 신호를 켠다
  const coach = ctx.settings.coachStyle || 'neighbor';

  const categories = await dbGetAll(ctx.db, 'categories');
  const rows = await listTransactionsByPeriod(ctx.db, key, startDay);
  const summary = summarizeMonth(rows, categories);

  // 평소 기준선: 이 달 앞의 최근 3개월 (기록이 있는 달만 평균에 넣는다)
  const prev = [];
  for (let i = 1; i <= 3; i++) {
    const k = shiftPeriodKey(key, -i);
    prev.push({ key: k, summary: summarizeMonth(await listTransactionsByPeriod(ctx.db, k, startDay), categories) });
  }
  const baseline = buildBaseline(prev);

  const head = headParts(key, nowKey);

  // 기록이 없는 달: 첫 행동 한 가지만 안내한다 (U11)
  if (rows.length === 0) {
    return el('section', {}, ...head,
      el('div', { class: 'card' },
        el('p', {}, key === nowKey ? '아직 기록이 없어요. 첫 기록을 남겨 볼까요?' : '이 달에는 기록이 없어요.'),
        el('a', { class: 'btn primary', href: '#/write' }, '직접 쓰기')),
      el('a', { class: 'btn', href: '#/home' }, '홈으로'));
  }

  const seed = key;
  // ---- 첫 인사 ----
  const hello = el('div', { class: 'card' },
    el('p', {}, pickPhrase('settleHello', coach, { 월: monthNumber(key) }, seed)),
    !ended ? el('p', { class: 'note' }, pickPhrase('settleRunning', coach, {}, seed)) : null);

  // ---- 수입·쓴 돈·남은 돈 ----
  const range = periodRange(key, startDay);
  const totals = el('div', { class: 'card' },
    el('p', { class: 'kicker' }, (ended ? '쓴 돈' : '지금까지 쓴 돈') + (startDay === 1 ? '' : ' (' + range.start.slice(5).replace('-', '/') + ' ~ ' + range.end.slice(5).replace('-', '/') + ')')),
    el('p', { class: 'big-number' }, formatWon(summary.expense)),
    summary.income > 0
      ? el('div', {},
          el('div', { class: 'row' }, el('p', {}, '들어온 돈'), el('p', { class: 'row-value' }, formatWon(summary.income))),
          el('div', { class: 'row' }, el('p', {}, summary.balance >= 0 ? '남은 돈' : '모자란 돈'), el('p', { class: 'row-value' }, formatWon(Math.abs(summary.balance)))))
      : el('p', { class: 'note' }, '수입을 기록하면 남은 돈을 알 수 있어요. 직접 쓰기에서 [받은 돈]을 고르면 돼요.'),
    summary.transfer > 0 ? el('p', { class: 'note' }, '옮긴 돈(이체) ' + formatWon(summary.transfer) + '은 쓴 돈에 넣지 않았어요.') : null,
    summary.reserveDeposit > 0 ? el('p', { class: 'note' }, '쓴 돈에는 미리 모으는 돈 ' + formatWon(summary.reserveDeposit) + '이 들어 있어요.') : null,
    summary.fromReserve > 0 ? el('p', { class: 'note' }, '미리 모은 돈으로 쓴 ' + formatWon(summary.fromReserve) + '은 쓴 돈에 넣지 않았어요. 모을 때 이미 넣었어요.') : null);

  // ---- 월 균형 신호 (끝난 달만) ----
  let balanceCard = null;
  if (ended) {
    const sig = balanceSignal(summary.income, summary.expense);
    if (sig) {
      const [shape, label] = BALANCE_LABEL[sig];
      balanceCard = el('div', { class: 'card sig-' + sig },
        el('p', { class: 'sig-line' }, el('span', { class: 'sig-shape', 'aria-hidden': 'true' }, shape), ' ', label),
        el('p', {}, pickPhrase({ green: 'balanceGreen', yellow: 'balanceYellow', red: 'balanceRed' }[sig], coach, {}, seed)),
        summary.oneoff > 0 ? el('p', { class: 'note' }, '큰 지출이 있었어요(일회성 ' + formatWon(summary.oneoff) + ' 포함).') : null);
    } else {
      balanceCard = el('div', { class: 'card' }, el('p', {}, pickPhrase('balanceNone', coach, {}, seed)));
    }
  }

  // ---- 남은 돈이 있으면 저금통 안내 (끝난 달만, D112) ----
  const saveCard = (ended && summary.income > 0 && summary.balance > 0)
    ? el('div', { class: 'card' },
        el('p', {}, monthNumber(key) + '월에 남은 돈이 ' + formatWon(summary.balance) + ' 있어요.'),
        el('p', { class: 'note' }, '남은 돈은 저금통의 [남은 돈 모음]에 적어 두실 수 있어요.'),
        el('a', { class: 'btn', href: '#/jar' }, '저금통으로'))
    : null;

  // ---- 이 달 저금통 (칸별 합계가 아니라 종류별 합계, 0이면 숨김) ----
  const moved = await movedByKind(ctx.db, range.start, range.end);
  const jarCard = (moved.reserve + moved.surplus) > 0
    ? el('div', { class: 'card' },
        el('h2', { class: 'card-title' }, '이 달 저금통에 모은 돈'),
        moved.reserve > 0 ? el('div', { class: 'row' }, el('p', {}, '미리 모으는 칸'), el('p', { class: 'row-value' }, formatWon(moved.reserve))) : null,
        moved.surplus > 0 ? el('div', { class: 'row' }, el('p', {}, '남은 돈 모음'), el('p', { class: 'row-value' }, formatWon(moved.surplus))) : null,
        el('p', { class: 'note' }, '이 앱은 실제 돈을 보관하지 않아요. 적어 둔 기록이에요.'))
    : null;

  // ---- 고정비·변동비·일회성 ----
  const kinds = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '어떤 돈이 나갔나요'),
    el('div', { class: 'row stack' }, el('p', {}, '고정비 (매달 나가는 돈)'), el('p', { class: 'row-value' }, formatWon(summary.fixed))),
    el('div', { class: 'row stack' }, el('p', {}, '변동비 (그때그때 쓴 돈)'), el('p', { class: 'row-value' }, formatWon(summary.variable))),
    el('div', { class: 'row stack' }, el('p', {}, '일회성 (한 번 크게 쓴 돈)'), el('p', { class: 'row-value' }, formatWon(summary.oneoff))));

  // ---- 분류별 순위 (위 5개와 나머지) ----
  const top = summary.byCategory.slice(0, 5);
  const restGroups = summary.byCategory.slice(5);
  const restSum = restGroups.reduce((a, g) => a + g.amount, 0);
  const max = top.length ? top[0].amount : 1;
  const bar = (name, amount, signalNode) => el('div', { class: 'bar-row' },
    el('div', { class: 'row' },
      el('p', { class: 'bar-name' }, name),
      el('p', { class: 'row-value' }, formatWon(amount))),
    el('div', { class: 'bar-track', 'aria-hidden': 'true' },
      el('div', { class: 'bar-fill', style: 'width:' + Math.max(2, Math.round(amount * 100 / max)) + '%' })),
    signalNode);
  const ranking = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '어디에 많이 썼나요'),
    summary.byCategory.length === 0 ? el('p', { class: 'meta' }, '쓴 돈 기록이 없어요.') : null,
    top.map((g) => {
      let node = null;
      if (g.essentialCat) {
        node = el('p', { class: 'sig-note small' }, '필수 지출이에요');
      } else if (ended) {
        const sig = categorySignal(g.countable, baseline.avg.get(g.id));
        if (sig) {
          const [shape, label] = CATEGORY_LABEL[sig];
          node = el('p', { class: 'sig-note small sig-' + sig }, el('span', { 'aria-hidden': 'true' }, shape), ' ' + label);
        }
      }
      return bar(g.name, g.amount, node);
    }),
    restGroups.length > 0 ? bar('나머지 ' + restGroups.length + '개 분류', restSum, null) : null);

  // ---- 말풀이 (늘어난 항목 1~2개) ----
  const talk = el('div', { class: 'card' }, el('h2', { class: 'card-title' }, '평소와 비교'));
  const basisBox = el('div', { class: 'card basis', hidden: true });
  if (!ended) {
    talk.append(el('p', {}, '이번 달이 끝나면 평소와 비교해서 알려 드릴게요.'));
  } else if (baseline.months === 0) {
    talk.append(el('p', {}, pickPhrase('baselineBuilding', coach, {}, seed)));
  } else {
    const rising = risingItems(summary, baseline);
    if (rising.length === 0) {
      talk.append(el('p', {}, pickPhrase('risingNone', coach, {}, seed)));
    } else {
      for (const r of rising) {
        talk.append(el('p', {}, r.name + ': ' + baselineName(baseline.months) + ' 평균(' + manWon(r.base) + ')보다 ' + manWon(r.over) + ' 더 썼어요.'));
      }
    }
    const basisBtn = el('button', { type: 'button', class: 'btn', 'aria-expanded': 'false' }, '기준 보기');
    basisBtn.addEventListener('click', () => {
      basisBox.hidden = !basisBox.hidden;
      basisBtn.setAttribute('aria-expanded', basisBox.hidden ? 'false' : 'true');
    });
    basisBox.append(
      el('p', {}, '비교한 달: ' + baseline.keys.map((k) => monthNumber(k) + '월').join(', ')),
      el('p', { class: 'note' }, '필수 지출, 일회성 지출, 응원 소비는 평소 계산에서 뺐어요.'));
    talk.append(basisBtn, basisBox);
  }

  return el('section', {}, ...head, hello, totals, balanceCard, saveCard, jarCard, kinds, ranking, talk,
    el('p', { class: 'note' }, '단순 계산 기준이며 투자·금융 자문이 아니에요.'),


    el('a', { class: 'btn', href: '#/history/' + key }, '내역 보기'),
    el('a', { class: 'btn', href: '#/home' }, '홈으로'));
}

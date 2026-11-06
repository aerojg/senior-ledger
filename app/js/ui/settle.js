/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// S7 결산 - 월 결산 한 장 (화면흐름 v1.1 S7, 말풀이틀 v1.0)
// 월 중에는 신호등을 칠하지 않고 "지금까지"의 금액과 순위만 보인다 (D42).
// 신호는 글자와 모양을 함께 쓰고 색만으로 구분하지 않는다 (U5).
import { el } from './dom.js';
import { foldBox } from './fold.js';
import { formatWon, formatDateKo } from './format.js';
import { dbGetAll } from '../storage/db.js';
import { todayStr, periodKeyOf, periodRange, shiftPeriodKey } from '../storage/dates.js';
import { listTransactionsByPeriod } from '../storage/transactions.js';
import { summarizeMonth, buildBaseline, balanceSignal, categorySignal, risingItems, buildPeriodTable, mergeCategories, buildRetire, buildLivingByCategory, RETIRE_RATE_MAX, buildJarYear, buildYearCompare, mergePay } from '../analysis/month.js';
import { movedByKind, movedByJar, listStatsOffJars, setJarStatsOff } from '../storage/jars.js'; // MOVED-BY-JAR
import { saveSetting } from './settings.js';
import { getYearReview, saveYearReview } from '../storage/yearReview.js';
import { isSettleOpen, settleWindow, getYearSettlement, planYearSettle, runYearSettle, undoYearSettle, refundTotalOf, settleTodayStr } from '../storage/yearSettle.js';

// 결산 가능 기간 판단에 쓰는 오늘. 시험할 때만 브라우저 콘솔에서 window.__GB_TODAY__ = '2027-01-05' 로 바꿀 수 있다.
const settleToday = settleTodayStr;
import { pickPhrase } from '../content/phrases.js';


// 결산 화면이 길어서 한 번에 다 읽기 어렵다(Q72, 2026-11-04). 카드의 제목을 눌러 펴고 접는 줄로 바꾼다.
// 요약(합계·돈 흐름)은 그대로 펴 두고, 세부 카드는 필요할 때 펴 보게 한다. 접어도 내용은 화면 안에 그대로 있다.
function foldCard(card, open) {
  if (!card) return card;
  const title = card.querySelector(':scope > .card-title');
  if (!title) return card;
  const det = el('details', { class: 'fold', open: open ? true : false });
  const sum = el('summary', {}, title.textContent);
  title.remove();
  det.append(sum, ...Array.from(card.childNodes));
  card.append(det);
  return card;
}

// "나머지 N개 분류" 아래에 단추를 달아 모두 펴 볼 수 있게 한다.
function restFold(n, listNodes) {
  return foldBox('나머지 ' + n + '개 분류', listNodes);
}

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

// 구분·분류·방법 줄은 모두 이 모양이다 (2026-11-06): 이름 / 금액 / 막대 / "N건 · 전체의 P%" / (있으면) 신호·펴기 줄
function barRow({ name, amount, count, total, max, signal = null, extra = [] }) {
  const pct = total > 0 ? Math.round(amount * 100 / total) : 0;
  const share = amount > 0 && pct < 1 ? '1% 미만' : pct + '%';   // 반올림, 1% 미만은 글로 쓴다
  const w = amount > 0 ? Math.min(100, Math.max(2, Math.round(amount * 100 / (max || amount)))) : 0;
  return el('div', { class: 'bar-row' },
    el('div', { class: 'row pct-row' },
      el('p', { class: 'bar-name' }, name),
      el('p', { class: 'row-value' }, formatWon(amount))),
    el('div', { class: 'bar-track', 'aria-hidden': 'true' },
      el('div', { class: 'bar-fill', style: 'width:' + w + '%' })),
    el('p', { class: 'meta' }, count + '건 · 전체의 ' + share),
    signal,
    ...extra);
}

// 어떤 방법으로 썼나요: 현금·체크카드 같은 지출 방법별 합계. 금액이 큰 방법부터 막대로 보여 준다.
// rows = [{ name, amount }], excluded = 방법을 나누지 않은 금액(미리 떼어 둔 돈 칸에 저금한 돈, 저금통 연말 결산)
function payCard(rows, excluded) {
  if (!rows.length) return null;
  const max = rows[0].amount;
  const total = rows.reduce((a, g) => a + g.amount, 0);
  return el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '어떤 방법으로 썼나요'),
    rows.map((g) => barRow({ name: g.name, amount: g.amount, count: g.count, total, max })),
    excluded > 0 ? el('p', { class: 'note' }, '저금통에 미리 떼어 둔 돈 ' + formatWon(excluded) + '은 방법을 나누지 않았어요.') : null);
}

// 평소와 비교: 평균과 이달을 막대 두 줄로 견주고, 그 아래에 한 문장으로 풀어 쓴다 (길이는 둘 중 큰 쪽이 기준)
function compareItem(r, months, monthNo) {
  const max = Math.max(r.base, r.amount);
  const one = (label, amount, cls) => el('div', { class: 'bar-row' },
    el('div', { class: 'row pct-row' },
      el('p', { class: 'bar-name' }, label),
      el('p', { class: 'row-value' }, formatWon(amount))),
    el('div', { class: 'bar-track', 'aria-hidden': 'true' },
      el('div', { class: 'bar-fill ' + cls, style: 'width:' + Math.min(100, Math.max(2, Math.round(amount * 100 / max))) + '%' })));
  return el('div', { class: 'cmp-item' },
    one(r.name + ' ' + baselineName(months) + ' 평균', r.base, 'bar-avg'),
    one(r.name + ' 이달(' + monthNo + '월)', r.amount, 'bar-up'),
    el('p', { class: 'cmp-text' }, r.name + ': ' + baselineName(months) + ' 평균보다 ', el('span', { class: 'nowrap' }, manWon(r.over)), ' 더 썼어요.'));
}
// 구분 한 가지에 들어 있는 쓴 돈 기록을 목록으로 보인다 (결산 "어떤 돈이 나갔나요" 줄의 [펴기 ▼] 안, 2026-11-06).
// 합계는 위 줄과 같은 기준(미리 떼어 둔 돈으로 쓴 기록과 이체는 뺀다, 저금통 적립은 쓴 돈이라 넣는다)이다.
function kindDetail(list, kind, key, nameOf) {
  const box = el('div', { class: 'kind-detail' });
  let sort = 'date';
  const paint = () => {
    const sorted = [...list].sort(sort === 'date'
      ? (a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1)
      : (a, b) => b.amount - a.amount || (a.date < b.date ? 1 : -1));
    const sortBtn = (id, label) => {
      const on = sort === id;
      const b = el('button', { type: 'button', class: 'btn seg' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false' }, (on ? '✓ ' : '') + label);
      b.addEventListener('click', () => { sort = id; paint(); });
      return b;
    };
    box.replaceChildren(
      el('div', { class: 'month-nav' }, sortBtn('date', '날짜순'), sortBtn('amount', '금액순')),
      ...sorted.map((r) => {
        const title = r.reserveDeposit ? '저금통' : (nameOf(r.categoryId) || '기타');
        const sub = [r.reserveDeposit ? '지출 적립' : '', r.merchant, r.memo].filter(Boolean).join(' · ');
        return el('a', { class: 'item', href: '#/edit/' + r.id + '/kind-' + kind + '-' + key },
          el('div', { class: 'item-main' },
            el('div', { class: 'item-line' },
              el('p', { class: 'item-title' }, title),
              el('p', { class: 'item-amount' }, formatWon(r.amount))),
            el('p', { class: 'meta' }, formatDateKo(r.date)),
            sub ? el('p', { class: 'meta' }, sub) : null));
      }),
      el('p', { class: 'note' }, '기록을 누르면 고칠 수 있어요. 구분이 잘못 들어갔다면 "기록 고치기" 화면에서 바꿔 주세요.'));
  };
  paint();
  return box;
}

// 쓴 돈·받은 돈·남은 돈처럼 같은 급으로 읽을 값은 모두 이 모양(□ 이름표 + 같은 크기 금액)으로 쓴다 (2026-11-04, 시인성)
function statItem(label, value) {
  return el('div', { class: 'stat' }, el('p', { class: 'kicker' }, label), el('p', { class: 'stat-value' }, value));
}
// 위 값들보다 한 단계 낮은 참고 값(한 달 평균 등)
function statSub(label, value) {
  return el('div', { class: 'row stat-sub' }, el('p', {}, label), el('p', { class: 'row-value' }, value));
}
function monthNumber(key) { return Number(key.split('-')[1]); }
// 구분(고정비·변동비·일회성): 월 결산 계산(summarizeMonth)과 같은 규칙으로 나눈다. 값이 없거나 모르는 값은 변동비다 (D139)
const KIND_LABEL = { fixed: '고정비 (매달 나가는 돈)', variable: '변동비 (그때그때 쓴 돈)', oneoff: '일회성 (한 번 크게 쓴 돈)' };
const KIND_OF = (r) => (r.costType === 'fixed' ? 'fixed' : r.costType === 'oneoff' ? 'oneoff' : 'variable');
let kindSort = 'amount';   // 목록 정렬(금액 큰 순서 / 날짜 최근 순서): 고치고 돌아와도 유지한다
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

// 저금통 카드 아래의 결산 안내: 결산했으면 결과 보기, 결산 기간이면 [저금통 연말 결산하기], 아니면 가능한 기간 안내
async function settleArea(ctx, year, jy) {
  if (!jy.rows.some((r) => r.diff !== 0)) return [];
  const done = await getYearSettlement(ctx.db, year);
  const link = (label, primary) => el('a', { class: 'btn' + (primary ? ' primary' : ''), href: '#/year/' + year + '/settle' }, label);
  if (done) return [el('p', { class: 'note' }, year + '년 저금통 연말 결산을 마쳤어요.'), link('결산 내용 보기', false)];
  if (isSettleOpen(year, settleToday())) return [link('저금통 연말 결산하기', true)];
  const w = settleWindow(year);
  return [el('p', { class: 'note' }, '저금통 연말 결산은 ' + kdate(w.start) + '부터 ' + kdate(w.end) + '까지 할 수 있어요.')];
}

// 저금통 연말 결산 화면: 어떻게 되는지 보여 주고 [결산하기]. 결산한 뒤에는 결과와 [결산 취소하기]
export async function yearSettleView(ctx, path, params) {
  const { nowKey } = resolveKey(ctx, {});
  const nowYear = Number(nowKey.split('-')[0]);
  let year = Number(params.y);
  if (!Number.isInteger(year) || year < 2000 || year > nowYear) year = nowYear;
  const box = el('section', {});
  const back = el('a', { class: 'btn', href: '#/year/' + year }, '연간 결산으로');
  const paint = async (message) => {
    const done = await getYearSettlement(ctx.db, year);
    const kids = [el('h1', {}, year + '년 저금통 연말 결산')];
    if (message) kids.push(el('div', { class: 'alert', role: 'alert' }, message));
    if (done) {
      kids.push(el('div', { class: 'card' },
        el('p', {}, '결산을 마쳤어요. 칸은 ' + (year + 1) + '년 0원에서 다시 시작해요.'),
        done.items.map((it) => el('div', { class: 'row stack' },
          el('p', { class: 'jar-name' }, it.name),
          el('p', {}, it.diff < 0 ? '먼저 쓴 돈 ' + formatWon(-it.diff) + '을 ' + year + '년 12월 31일 쓴 돈(기타)으로 확정했어요.' : '남은 돈 ' + formatWon(it.diff) + '을 정리했어요. ' + year + '년 쓴 돈에서 뺐어요.')))));
      const undo = el('button', { type: 'button', class: 'btn' }, '결산 취소하기');
      undo.addEventListener('click', async () => {
        undo.disabled = true;
        try { await undoYearSettle(ctx.db, year); await paint('결산을 취소했어요.'); }
        catch (e) { console.error(e); undo.disabled = false; await paint(e.userMessage || '취소하지 못했어요. 한 번 더 눌러 주세요.'); }
      });
      kids.push(undo);
    } else {
      const plan = await planYearSettle(ctx.db, year);
      const open = isSettleOpen(year, settleToday());
      if (plan.rows.length === 0) {
        kids.push(el('div', { class: 'card' }, el('p', {}, '결산할 돈이 없어요.')));
      } else {
        kids.push(el('div', { class: 'card' },
          el('h2', { class: 'card-title' }, '결산하면 이렇게 돼요'),
          plan.rows.map((r) => el('div', { class: 'row stack' },
            el('p', { class: 'jar-name' }, r.name),
            el('p', {}, r.diff < 0
              ? '▲ 먼저 쓴 돈 ' + formatWon(-r.diff) + ' → ' + year + '년 12월 31일 쓴 돈(기타)으로 확정하고, 칸은 0원이 돼요.'
              : '● 남은 돈 ' + formatWon(r.diff) + ' → ' + year + '년 "쓴 돈"에서 빼고, 칸은 0원이 돼요.'))),
          el('p', { class: 'note' }, '남은 돈 모음은 결산하지 않고 새해에도 이어 가요. 월 결산 숫자는 바뀌지 않고, 연간 결산의 "쓴 돈"에서만 되돌린 돈을 빼요. 결산한 뒤에도 [결산 취소하기]로 되돌릴 수 있어요. 이 앱은 실제 돈을 보관하지 않아요.')));
        if (open) {
          const go = el('button', { type: 'button', class: 'btn primary' }, '결산하기');
          go.addEventListener('click', async () => {
            go.disabled = true;
            try { await runYearSettle(ctx.db, year, settleToday()); await paint(); }
            catch (e) { console.error(e); go.disabled = false; await paint(e.userMessage || '결산하지 못했어요. 한 번 더 눌러 주세요.'); }
          });
          kids.push(go);
        } else {
          const w = settleWindow(year);
          kids.push(el('div', { class: 'card' }, el('p', {}, '아직 결산할 수 없어요. ' + kdate(w.start) + '부터 ' + kdate(w.end) + '까지 할 수 있어요.')));
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
  const foot = [year === nowYear ? el('a', { class: 'btn primary', href: '#/retire' }, '미래 생활비 미리보기') : null,
    el('a', { class: 'btn', href: '#/settle' }, '결산으로'), el('a', { class: 'btn', href: '#/home' }, '홈으로')];

  if (t.total.months === 0) {
    return el('section', {}, ...head, el('div', { class: 'card' }, el('p', {}, year + '년에는 기록이 없어요.')), ...foot);
  }

  const running = year === nowYear && settleToday() <= year + '-12-31';
  const refund = await refundTotalOf(ctx.db, year);          // 저금통 연말 결산에서 되돌린 돈: 연간 쓴 돈에서만 뺀다
  const spent = t.total.expense - refund;
  const avg = t.total.months ? Math.round(spent / t.total.months) : 0;
  const balance = t.total.balance + refund;
  const flow = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '돈 흐름'),
    statItem(running ? '지금까지 쓴 돈' : '1년 동안 쓴 돈', formatWon(spent)),
    refund > 0 ? el('p', { class: 'note' }, '저금통 연말 결산에서 되돌린 ' + formatWon(refund) + '을 뺀 금액이에요. 아래 달마다 막대와 분류 순위는 되돌리기 전 금액이에요.') : null,
    t.total.income > 0 ? statItem('받은 돈', formatWon(t.total.income)) : el('p', { class: 'note' }, '수입을 기록하면 남은 돈도 알 수 있어요.'),
    t.total.balanceMonths > 0 ? statItem(balance >= 0 ? '남은 돈' : '모자란 돈', formatWon(Math.abs(balance))) : null,
    statSub('한 달 평균', formatWon(avg)),
    t.total.balanceMonths > 0 && t.total.balanceMonths < t.total.months ? el('p', { class: 'note' }, '남은 돈은 수입을 적은 달(' + t.total.balanceMonths + '개월)만 계산했어요.') : null,
    running ? el('p', { class: 'note' }, year + '년은 아직 지나는 중이라 연말까지 달라질 수 있어요.') : null);

  const used = t.rows.filter((r) => r.hasData);
  const maxE = Math.max(1, ...used.map((r) => r.expense));
  const bars = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '달마다 쓴 돈'),
    used.map((r) => el('div', { class: 'bar-row' },
      el('div', { class: 'row pct-row' }, el('p', { class: 'bar-name' }, monthNumber(r.key) + '월'), el('p', { class: 'row-value' }, formatWon(r.expense))),
      el('div', { class: 'bar-track', 'aria-hidden': 'true' },
        el('div', { class: 'bar-fill', style: 'width:' + Math.min(100, Math.max(2, Math.round(r.expense * 100 / maxE))) + '%' })))),
    used.length < t.rows.length ? el('p', { class: 'note' }, '기록 없는 달은 보이지 않아요.') : null);

  const cats = mergeCategories(list.map((x) => x.summary));
  const top = cats.slice(0, 5);
  const restSum = cats.slice(5).reduce((a, g) => a + g.amount, 0);
  const maxC = top.length ? top[0].amount : 1;
  const catTotalY = cats.reduce((a, g) => a + g.amount, 0);
  const cbar = (name, amount, count) => barRow({ name, amount, count, total: catTotalY, max: maxC });
  const rank = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '어디에 많이 썼나요'),
    top.length === 0 ? el('p', { class: 'meta' }, '쓴 돈 기록이 없어요.') : null,
    top.map((g, i) => cbar((i + 1) + '위 ' + g.name, g.amount, g.count)),
    cats.length > 5 ? cbar('나머지 ' + (cats.length - 5) + '개 분류', restSum, cats.slice(5).reduce((a, g) => a + g.count, 0)) : null,
    cats.length > 5 ? restFold(cats.length - 5, cats.slice(5).map((g, i) => cbar((i + 6) + '위 ' + g.name, g.amount, g.count))) : null);
  // 분류별 월간 평균 보기: 평소에는 접어 두고, 누르면 모든 분류의 한 달 평균을 보여 준다 (위 순위와 같은 금액을 기록이 있는 달 수로 나눈다)
  if (cats.length > 0) {
    const mCount = t.total.months;
    const avgParts = foldBox('분류별 월간 평균', [
      el('p', { class: 'kicker' }, '분류별 한 달 평균'),
      ...cats.map((g) => el('div', { class: 'row' },
        el('div', {}, el('p', {}, g.name), el('p', { class: 'meta' }, year + '년 합계 ' + formatWon(g.amount))),
        el('p', { class: 'row-value' }, formatWon(Math.round(g.amount / mCount))))),
      el('p', { class: 'note' }, '위 순위와 같은 금액을 기록이 있는 ' + mCount + '개월로 나눈 값이에요. 일회성 지출과 미리 떼어 둔 돈도 들어 있어요.')], { id: 'year-cat-avg' });
    rank.append(...avgParts);
  }
  if (catTotalY > 0) rank.append(el('p', { class: 'meta' }, '퍼센트는 쓴 돈 합계에서 차지하는 몫이고, 반올림한 값이에요.'));

  // ---- 저금통 연말 결산 보기 (미리 떼어 둔 돈 칸의 한 해 적립·집행·차이, 보기만 한다, D114) ----
  const jy = buildJarYear(await dbGetAll(ctx.db, 'jars'), await dbGetAll(ctx.db, 'jarEntries'), year);
  const jarCard = jy.rows.length === 0 ? null : el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '저금통'),
    jy.rows.map((r) => {
      const tags = [r.done ? '마무리한 칸' : null, r.statsOff && !r.name.includes('통계 제외') ? '통계 제외' : null].filter(Boolean);
      return el('div', { class: 'kv-block' },
        el('p', { class: 'bar-name jar-name' }, r.name),
        tags.length ? el('p', { class: 'meta kv-tags' }, tags.join(' · ')) : null,
        el('div', { class: 'kv-line' }, el('span', {}, '모은 돈'), el('span', { class: 'row-value' }, formatWon(r.moved))),
        el('div', { class: 'kv-line' }, el('span', {}, '쓴 돈'), el('span', { class: 'row-value' }, formatWon(r.used))),
        el('div', { class: 'kv-line result' },
          el('span', {}, r.diff < 0 ? '▲ 먼저 쓴 돈' : r.diff > 0 ? '● 남은 돈' : '■ 딱 맞아요'),
          el('span', { class: 'row-value' }, formatWon(Math.abs(r.diff)))));
    }),
    el('p', { class: 'note' }, '남은 돈은 저금통 연말 결산 때 정리할 돈이고, 먼저 쓴 돈은 올해 안에 저금해서 채워야 하는 돈이에요. 이 앱은 실제 돈을 보관하지 않아요.'),
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
      el('p', { class: 'note' }, year + '년 쓴 돈은 ' + (year - 1) + '년보다 ' + word(c.expenseTrend, c.expenseDiff) + '.'),
      el('p', { class: 'note' }, '한 달 평균은 ' + formatWon(prevRec.snapshot.avg) + '에서 ' + formatWon(avg) + '으로, ' + word(c.avgTrend, c.avgDiff) + '.'),
      el('p', { class: 'kicker' }, '많이 쓴 분류'),
      el('p', { class: 'meta' }, '▲ 늘었어요 · ▼ 줄었어요'),
      c.cats.map((g) => el('div', { class: 'kv-block' },
        el('div', { class: 'kv-line' },
          el('span', { class: 'bar-name' }, g.name),
          el('span', { class: 'row-value ' + (g.trend === 'more' ? 'trend-up' : g.trend === 'less' ? 'trend-down' : '') }, g.trend === 'same' ? '■ 비슷해요' : mark(g.trend) + ' ' + formatWon(Math.abs(g.diff)))),
        el('p', { class: 'meta kv-years' }, el('span', {}, (year - 1) + '년 ' + formatWon(g.prev)), el('span', {}, '→ ' + year + '년 ' + formatWon(g.now))))),
      running ? el('p', { class: 'note' }, year + '년은 아직 지나는 중이라 연말까지 달라질 수 있어요.') : null,
      el('p', { class: 'note' }, '저장해 둔 ' + (year - 1) + '년 숫자와 견준 단순 계산이에요.'));
  }

  const yp = mergePay(list.map((x) => x.summary));
  return el('section', {}, ...head, flow, foldCard(bars, false), foldCard(rank, true), foldCard(payCard(yp.rows, yp.excluded), false), foldCard(jarCard, false), foldCard(compareCard, false), saveBox,
    el('p', { class: 'note' }, '단순 계산 기준이며 투자·금융 자문이 아니에요.'), ...foot);
}

// S10 미래 생활비 미리보기 (연간 결산 2단계): 고른 기간의 한 달 생활비 평균 + 늘어날 돈 - 줄어들 돈 (2026-11-06 이름·기준 기간 변경)
// 화면 주소(#/retire)와 저장 이름(settings.retirement)은 예전 그대로 쓴다.
const RETIRE_STEP = 100000;
const RETIRE_MAX = 100000000;
const BASE_MODES = ['last3', 'last1', 'lastyear'];   // 기본은 최근 3개월 평균, 기록이 없으면 이 순서로 다른 기준을 쓴다
export async function retireView(ctx) {
  const box = el('section', {});
  // 기준 기간을 바꾸면 화면 전체를 다시 계산해 그린다 (보던 자리는 그대로 둔다)
  const redo = async () => {
    const y = window.scrollY;
    const sec = await retirePaint(ctx, redo);
    box.replaceChildren(...Array.from(sec.childNodes));
    window.scrollTo(0, y);
  };
  await redo();
  return box;
}
async function retirePaint(ctx, redo) {
  const { startDay, nowKey } = resolveKey(ctx, {});
  const categories = await dbGetAll(ctx.db, 'categories');
  const saved = ctx.settings.retirement || {};
  // 기준 기간: 끝난 달만 쓴다 (이번 달은 아직 지나는 중이라 뺀다)
  const prev1 = shiftPeriodKey(nowKey, -1);
  const lastYear = Number(nowKey.slice(0, 4)) - 1;
  const monthList = async (keys) => {
    const out = [];
    for (const k of keys) out.push({ key: k, summary: summarizeMonth(await listTransactionsByPeriod(ctx.db, k, startDay), categories) });
    return out;
  };
  const lists = {
    last1: await monthList([prev1]),
    last3: await monthList([shiftPeriodKey(nowKey, -3), shiftPeriodKey(nowKey, -2), prev1]),
    lastyear: await monthList(Array.from({ length: 12 }, (_, i) => lastYear + '-' + String(i + 1).padStart(2, '0'))),
  };
  const BASE_LABEL = { last1: '지난달 (' + monthNumber(prev1) + '월)', last3: '최근 3개월 평균', lastyear: '작년 결산 (' + lastYear + '년)' };
  const usable = (x) => x.summary.count > 0 && x.summary.expense - x.summary.oneoff - x.summary.reserveDeposit > 0;   // buildRetire가 세는 달과 같은 기준
  const avail = {};
  for (const m of BASE_MODES) avail[m] = buildRetire(lists[m]).months > 0;
  const chosen = BASE_MODES.includes(saved.baseMode) ? saved.baseMode : 'last3';   // 사용자가 고른 기준
  const useMode = avail[chosen] ? chosen : (BASE_MODES.find((m) => avail[m]) || chosen);   // 기록이 없으면 있는 기준으로 대신 계산한다
  const list = lists[useMode];
  // 저장 모양: delta(전체 한번에 증감, 늘면 +·줄면 −), deltaBy(분류별 증감), mode('all' 전체 한번에 / 'cat' 분류별). 한 번에 한 방법만 쓴다.
  // 예전 저장(더 들 돈 up·upBy, 덜 들 돈 down·downBy)은 처음 열 때 증감 하나로 바꿔 읽는다.
  const cleanMap = (m, sign = 1) => { const o = {}; if (m && typeof m === 'object') for (const [k, v] of Object.entries(m)) { const n = Math.round(Number(v)) * sign; if (Number.isFinite(n) && n !== 0) o[k] = Math.max(-RETIRE_MAX, Math.min(RETIRE_MAX, n)); } return o; };
  const sumMap = (m) => Object.values(m).reduce((a, v) => a + v, 0);
  const clampWon = (n) => Math.max(-RETIRE_MAX, Math.min(RETIRE_MAX, Math.round(n) || 0));
  const st = { delta: 0, deltaBy: {}, mode: 'all', rate: Number(saved.rate) || 0, baseMode: chosen };
  if (saved.mode === 'all' || saved.mode === 'cat') {
    st.mode = saved.mode; st.delta = clampWon(saved.delta); st.deltaBy = cleanMap(saved.deltaBy);
  } else {
    const upBy = cleanMap(saved.upBy), downBy = cleanMap(saved.downBy), up = Number(saved.up) || 0, down = Number(saved.down) || 0;
    const modeOf = (m, all, by) => (m === 'all' || m === 'cat' ? m : (all === 0 && Object.keys(by).length > 0 ? 'cat' : 'all'));
    const um = modeOf(saved.upMode, up, upBy), dm = modeOf(saved.downMode, down, downBy);
    if (um === 'cat' && dm === 'cat') {
      st.mode = 'cat';
      for (const id of new Set([...Object.keys(upBy), ...Object.keys(downBy)])) { const n = (upBy[id] || 0) - (downBy[id] || 0); if (n) st.deltaBy[id] = n; }
    } else {
      st.delta = clampWon((um === 'cat' ? sumMap(upBy) : up) - (dm === 'cat' ? sumMap(downBy) : down));
    }
  }
  const ups = () => (st.mode === 'cat' ? Object.values(st.deltaBy).filter((v) => v > 0).reduce((a, v) => a + v, 0) : Math.max(0, st.delta));          // 늘어날 돈
  const downs = () => (st.mode === 'cat' ? -Object.values(st.deltaBy).filter((v) => v < 0).reduce((a, v) => a + v, 0) : Math.max(0, -st.delta));    // 줄어들 돈
  const onRefresh = [];
  const foot = [el('a', { class: 'btn', href: '#/year' }, '연간 결산으로'), el('a', { class: 'btn', href: '#/home' }, '홈으로')];
  const first = buildRetire(list);
  const anySpent = BASE_MODES.some((m) => lists[m].some((x) => x.summary.expense > 0));
  if (first.months === 0) {
    return el('section', {}, el('h1', {}, '미래 생활비 미리보기'),
      el('div', { class: 'card' },
        el('p', {}, anySpent
          ? '쓴 돈이 모두 일회성 지출이거나 미리 떼어 둔 돈이라서, 생활비로 셀 수 있는 기록이 아직 없어요.'
          : '지난달 이전에 쓴 돈 기록이 아직 없어서 계산할 수 없어요. 이번 달이 지나고 기록이 쌓이면 다시 와 주세요.'),
        anySpent ? el('p', { class: 'note' }, '매달 쓰는 식비·생활비 같은 기록이 쌓이면 계산해 드려요.') : null), ...foot);
  }

  const usedKeys = list.filter(usable).map((x) => x.key).sort();
  const usedText = usedKeys.map((k) => monthNumber(k) + '월').join(', ');
  const periodNote = useMode === 'last1' ? '지난달(' + monthNumber(prev1) + '월) 한 달 기록이에요.'
    : useMode === 'last3' ? (first.months === 3 ? '최근 3개월(' + usedText + ') 평균이에요.' : '최근 3개월 중 기록이 있는 ' + first.months + '개월(' + usedText + ') 평균이에요.')
    : (first.months === 12 ? lastYear + '년 12개월 평균이에요.' : lastYear + '년 중 기록이 있는 ' + first.months + '개월 평균이에요.');
  // 기준 기간 고르기: 끝난 달 기록이 없는 기준은 누를 수 없고 이유를 적는다
  const baseBtns = BASE_MODES.slice().sort((x, y) => ['last1', 'last3', 'lastyear'].indexOf(x) - ['last1', 'last3', 'lastyear'].indexOf(y)).map((m) => {
    const on = useMode === m;
    const b = el('button', { type: 'button', class: 'btn seg' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', disabled: avail[m] ? null : true }, (on ? '✓ ' : '') + BASE_LABEL[m]);
    if (avail[m]) b.addEventListener('click', async () => { if (st.baseMode === m && useMode === m) return; st.baseMode = m; await persist(); await redo(); });
    return b;
  });
  const noRec = BASE_MODES.filter((m) => !avail[m]).sort().map((m) => ({ last1: '지난달', last3: '최근 3개월', lastyear: '작년(' + lastYear + '년)' })[m]);
  const baseNote = el('p', { class: 'note' }, '일회성 지출(한 번 크게 쓴 돈)과 미리 떼어 둔 돈은 뺀 금액이에요. ' + periodNote);
  const baseCard = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '1. 기준 생활비 (월간)'),
    el('p', { class: 'meta' }, '지금의 내 생활비를 바탕으로, 미래 생활비 계산의 기준이 되는 한 달 생활비예요.'),
    el('p', { class: 'kicker' }, '어느 기간으로 계산할까요?'),
    ...baseBtns,
    noRec.length ? el('p', { class: 'meta' }, noRec.join(', ') + '은 쓴 돈 기록이 없어서 고를 수 없어요.') : null,
    useMode !== chosen ? el('p', { class: 'note' }, '고르신 ' + BASE_LABEL[chosen] + '은 기록이 없어서 ' + BASE_LABEL[useMode] + '으로 계산했어요.') : null,
    el('p', { class: 'big-number' }, formatWon(first.base)),
    el('div', { class: 'row' }, el('p', {}, '매달 나가는 돈 (고정비)'), el('p', { class: 'row-value' }, formatWon(first.fixed))),
    el('div', { class: 'row' }, el('p', {}, '그때그때 쓰는 돈 (변동비)'), el('p', { class: 'row-value' }, formatWon(first.variable))),
    baseNote);
  // 분류별로 보기: 평소에는 접어 두고, 누르면 분류마다 한 달 평균을 보여 준다. 합계는 위 금액과 같다.
  const living = buildLivingByCategory(list);
  if (living.rows.length) {
    // 묶는 기준: 전체의 2% 미만은 "소액 분류"로 묶는다(개수 상한 없음). 묶인 줄은 눌러서 펼친다.
    const big = living.rows.filter((r) => r.amount * 50 >= living.base);   // 실제 금액으로 비교 (2% 이상)
    const top = big;
    const shown = new Set(top.map((r) => r.id));
    const rest = living.rows.filter((r) => !shown.has(r.id));
    const restSum = rest.reduce((a, r) => a + r.amount, 0);
    const pct = (n) => (living.base > 0 ? Math.round(n * 100 / living.base) : 0);
    const pctText = (n) => (pct(n) < 1 ? '전체의 1% 미만' : '전체의 ' + pct(n) + '%');   // 앱 전체와 같이 정수로 반올림한다
    const rowOf = (r) => el('div', { class: 'row' },
      el('div', {}, el('p', {}, r.name), el('p', { class: 'meta' }, [r.fixed > 0 ? '고정 ' + formatWon(r.fixed) : null, r.variable > 0 ? '변동 ' + formatWon(r.variable) : null].filter(Boolean).join(' · '))),
      el('div', {}, el('p', { class: 'row-value' }, formatWon(r.amount)), el('p', { class: 'meta' }, pctText(r.amount))));
    const restParts = rest.length ? foldBox('나머지 ' + rest.length + '개 분류', rest.map(rowOf), { id: 'ret-living-rest' }) : [];
    const detailParts = foldBox('분류별 한 달 평균', [
      el('p', { class: 'kicker' }, '분류별 한 달 평균'),
      ...top.map(rowOf), ...restParts,
      el('p', { class: 'note' }, '분류별 금액을 모두 더하면 위의 한 달 생활비와 같아요. 전체의 2%보다 작은 분류는 "나머지 분류"로 묶었어요.')], { id: 'ret-living-detail' });
    baseCard.append(...detailParts);
  }

  const resultNums = {
    monthly: el('p', { class: 'big-number' }), diff: el('p', {}), warn: el('p', { class: 'note' }), cmp: el('div', {}),
    yearly: el('div', {}), five: el('div', {}), ten: el('div', {}), later: el('div', {}),
    sumKicker: el('p', { class: 'kicker' }),
  };
  const money = (n) => formatWon(n);
  // 물가를 넣으면 물가를 반영한 금액이 주인공이고, 넣지 않은 금액은 비교용으로 작게 보여 준다
  const periodRow = (box, label, plain, priced, rate) => {
    // replaceChildren은 null을 "null" 글자로 넣으므로 빈 칸은 걸러서 넘긴다
    box.replaceChildren(...[
      el('div', { class: 'row' }, el('p', {}, label), el('p', { class: 'row-value' }, money(rate > 0 ? priced : plain))),
      rate > 0 ? el('p', { class: 'meta' }, '물가를 넣지 않으면 ' + money(plain) + ' · 물가 때문에 ' + money(priced - plain) + ' 더 들어요') : null,
    ].filter(Boolean));
  };
  const refresh = () => {
    const r = buildRetire(list, ups(), downs(), st.rate);
    resultNums.monthly.textContent = money(r.monthly);
    const mark = r.diff > 0 ? '▲ ' : r.diff < 0 ? '▼ ' : '■ ';
    resultNums.diff.textContent = mark + (r.diff === 0 ? '기준 생활비와 같아요' : '기준 생활비보다 ' + money(Math.abs(r.diff)) + (r.diff > 0 ? ' 더 써요' : ' 덜 써요'));
    // 줄어들 돈이 기준 생활비보다 크면 0원으로 계산되므로 알려 준다
    resultNums.warn.textContent = downs() - ups() > r.base ? '줄어들 돈이 기준 생활비보다 커서 한 달 생활비를 0원으로 계산했어요.' : '';
    resultNums.warn.hidden = !resultNums.warn.textContent;
    // 분류별 비교: 바뀐 분류만 "기준 → 앞으로"로 보여 준다
    const by = st.mode === 'cat' ? st.deltaBy : {};
    const cmpRows = Object.keys(by).map((id) => {
      const before = (livingBy.get(id) || {}).amount || 0;
      const after = Math.max(0, before + by[id]);
      return { id, name: catName.get(id) || (livingBy.get(id) || {}).name || '기타', before, after };
    }).filter((x) => x.before !== x.after).sort((x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before));
    const bunRows = st.mode === 'all' && st.delta !== 0 ? [['전체 한번에 변경', (st.delta > 0 ? '▲ ' : '▼ ') + money(Math.abs(st.delta)), st.delta]] : [];
    resultNums.cmp.replaceChildren(...(cmpRows.length || bunRows.length ? [
      el('p', { class: 'kicker' }, st.mode === 'cat' ? '분류별로 달라지는 한 달 금액' : '달라지는 한 달 금액'),
      ...cmpRows.map((x) => el('div', { class: 'kv-block' },
        el('div', { class: 'kv-line' },
          el('span', { class: 'bar-name' }, x.name),
          el('span', { class: 'row-value ' + (x.after > x.before ? 'trend-up' : 'trend-down') }, (x.after > x.before ? '▲ ' : '▼ ') + money(Math.abs(x.after - x.before)))),
        el('p', { class: 'meta kv-years' }, el('span', {}, '기준 ' + money(x.before)), el('span', {}, '→ 앞으로 ' + money(x.after))))),
      ...bunRows.map((x) => el('div', { class: 'kv-block' },
        el('div', { class: 'kv-line' }, el('span', { class: 'bar-name' }, x[0]), el('span', { class: 'row-value ' + (x[2] > 0 ? 'trend-up' : 'trend-down') }, x[1]))))] : []));
    onRefresh.forEach((f) => f());
    resultNums.sumKicker.textContent = '앞으로 쓰게 될 돈 합계' + (r.rate > 0 ? ' (물가 반영)' : '');
    periodRow(resultNums.yearly, '1년', r.yearly, r.yearlyP, r.rate);
    periodRow(resultNums.five, '5년', r.five, r.fiveP, r.rate);
    periodRow(resultNums.ten, '10년', r.ten, r.tenP, r.rate);
    resultNums.later.replaceChildren(...(r.rate > 0 ? [
      el('p', { class: 'kicker' }, '물가가 연 ' + r.rate + '% 오르면 한 달 생활비는'),
      el('div', { class: 'row' }, el('p', {}, '1년 뒤'), el('p', { class: 'row-value' }, money(r.monthly1))),
      el('div', { class: 'row' }, el('p', {}, '5년 뒤'), el('p', { class: 'row-value' }, money(r.monthly5))),
      el('div', { class: 'row' }, el('p', {}, '10년 뒤'), el('p', { class: 'row-value' }, money(r.monthly10)))] : []));
  };
  const persist = () => saveSetting(ctx, { retirement: { delta: st.delta, deltaBy: st.deltaBy, mode: st.mode, rate: st.rate, baseMode: st.baseMode } });

  // 직접 쓰기 칸: 쓰는 동안 바로 계산하고, 칸을 벗어나면 저장한다.
  const entry = (id, label, unit, initial, onType, onDone) => {
    const input = el('input', { class: 'input', id, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: initial, 'aria-label': label });
    input.addEventListener('input', () => onType(input.value));
    input.addEventListener('change', () => onDone());
    return { input, node: el('div', {}, el('label', { class: 'label', for: id }, label), el('div', { class: 'unit-entry' }, input, el('span', { class: 'unit' }, unit))) };
  };
  const parseNum = (t) => { const v = parseFloat(String(t).replace(/,/g, '')); return Number.isFinite(v) && v >= 0 ? v : 0; };
  const manText = (won) => String(Math.round(won / 1000) / 10).replace(/\.0$/, '');

  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const livingBy = new Map(buildLivingByCategory(list).rows.map((r) => [r.id, r]));
  const CAT_STEP = 10000;
  // 분류별 값은 기준 금액까지만 줄일 수 있다(저장된 값이 그보다 크면 맞춰 둔다)
  for (const id of Object.keys(st.deltaBy)) { const avg = (livingBy.get(id) || {}).amount || 0; if (st.deltaBy[id] < -avg) { if (avg > 0) st.deltaBy[id] = -avg; else delete st.deltaBy[id]; } }

  const signText = (n) => (n > 0 ? '▲ ' + formatWon(n) : n < 0 ? '▼ ' + formatWon(-n) : '0원');
  // 늘어요/줄어요 단추 (눌린 쪽에 ✓): 칸에는 숫자만 쓰므로 방향은 이 단추로 고른다
  const dirButtons = (getDir, setDir) => {
    const inc = el('button', { type: 'button' }, '늘어요');
    const dec = el('button', { type: 'button' }, '줄어요');
    const sync = () => {
      const d = getDir();
      for (const [b, on, t] of [[inc, d > 0, '늘어요'], [dec, d < 0, '줄어요']]) { b.className = 'btn seg' + (on ? ' on' : ''); b.setAttribute('aria-pressed', String(on)); b.textContent = (on ? '✓ ' : '') + t; }
    };
    inc.addEventListener('click', () => setDir(1));
    dec.addEventListener('click', () => setDir(-1));
    sync();
    return { node: el('div', { class: 'month-nav' }, inc, dec), sync };
  };
  // 줄이기/늘리기 단추: 줄이기는 값을 내리고 늘리기는 올린다. 줄일 수 있는 한도(minV)에 닿으면 줄이기가 비활성이 된다.
  const stepButtons = (stepWon, stepLabel, getVal, apply, getMin) => {
    const less = el('button', { type: 'button', class: 'btn' }, stepLabel + ' 줄이기');
    const more = el('button', { type: 'button', class: 'btn' }, stepLabel + ' 늘리기');
    const sync = () => { const v = getVal(); less.disabled = v <= getMin(); more.disabled = v >= RETIRE_MAX; };
    less.addEventListener('click', () => apply(-stepWon));
    more.addEventListener('click', () => apply(stepWon));
    sync();
    return { node: el('div', { class: 'month-nav' }, less, more), sync };
  };

  // 전체 한번에 변경
  const buildAll = () => {
    let dir = st.delta < 0 ? -1 : 1;
    const val = el('p', { class: 'big-number' });
    let dirs, steps;
    const show = () => { val.textContent = formatWon(Math.abs(st.delta)); dirs.sync(); steps.sync(); };
    const ent = entry('ret-delta', '직접 쓰기', '만 원', manText(Math.abs(st.delta)),
      (t) => { st.delta = clampWon(dir * parseNum(t) * 10000); val.textContent = formatWon(Math.abs(st.delta)); steps.sync(); refresh(); },
      async () => { ent.input.value = manText(Math.abs(st.delta)); await persist(); });
    dirs = dirButtons(() => dir, async (d) => { dir = d; st.delta = d * Math.abs(st.delta); show(); refresh(); await persist(); });
    const apply = async (d) => { st.delta = clampWon(st.delta + d); if (st.delta !== 0) dir = st.delta < 0 ? -1 : 1; ent.input.value = manText(Math.abs(st.delta)); show(); refresh(); await persist(); };
    steps = stepButtons(RETIRE_STEP, '10만 원', () => st.delta, apply, () => -RETIRE_MAX);
    show();
    return [dirs.node, el('p', { class: 'kicker' }, '늘거나 줄 돈'), val, ent.node, steps.node,
      el('p', { class: 'note' }, '분류를 따지지 않고 한 달에 늘거나 줄 돈을 하나로 넣어요.'),
      ...foldBox('넣는 방법', [el('p', { class: 'note' }, '먼저 [늘어요]나 [줄어요]를 고르세요. 그다음 금액을 칸에 직접 쓰거나, [10만 원 늘리기]·[10만 원 줄이기]로 바꾸세요. 칸에는 만 원 단위로 쓸 수 있어요. 예: 3.5 → 3만 5천 원. 바꾼 값은 저절로 저장돼요.')])];
  };

  // 분류별로 변경: 분류 줄을 누르면 입력 칸이 펼쳐지고, 한 번에 한 분류만 펼친다.
  const buildCat = () => {
    const map = st.deltaBy;
    const seen = new Set();
    const items = categories.filter((c) => c.kind === 'expense' && c.isActive !== false).sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((c) => { seen.add(c.id); return { id: c.id, name: c.name, avg: (livingBy.get(c.id) || {}).amount || 0 }; });
    for (const r of livingBy.values()) if (!seen.has(r.id)) items.push({ id: r.id, name: r.name, avg: r.amount });
    const list2 = el('div', {});
    const panels = [];
    for (const it of items) {
      const lower = -it.avg;   // 기준 금액까지만 줄일 수 있다
      let dir = (map[it.id] || 0) < 0 ? -1 : 1;
      let dirs, steps;
      const amtText = el('span', { class: 'cat-val' });
      const paint = () => {
        const v = map[it.id] || 0;
        amtText.textContent = signText(v);
        amtText.className = 'cat-val' + (v > 0 ? ' trend-up' : v < 0 ? ' trend-down' : ' zero');
        if (dirs) dirs.sync(); if (steps) steps.sync();
      };
      const set = (v) => { const n = Math.max(lower, Math.min(RETIRE_MAX, Math.round(v))); if (n) map[it.id] = n; else delete map[it.id]; if (n) dir = n < 0 ? -1 : 1; paint(); refresh(); };
      const ent = entry('ret-cat-' + it.id, it.name + ' 직접 쓰기', '만 원', manText(Math.abs(map[it.id] || 0)),
        (t) => set(dir * parseNum(t) * 10000), async () => { ent.input.value = manText(Math.abs(map[it.id] || 0)); await persist(); });
      const move = async (d) => { set((map[it.id] || 0) + d); ent.input.value = manText(Math.abs(map[it.id] || 0)); await persist(); };
      steps = stepButtons(CAT_STEP, '1만 원', () => map[it.id] || 0, move, () => lower);
      dirs = it.avg > 0 ? dirButtons(() => dir, async (d) => { dir = d; set(d * Math.abs(map[it.id] || 0)); await persist(); }) : null;
      const quick = [];
      if (it.avg > 0) {
        const all = el('button', { type: 'button', class: 'btn' }, '전부 빼기');
        const half = el('button', { type: 'button', class: 'btn' }, '절반 빼기');
        all.addEventListener('click', async () => { set(-it.avg); ent.input.value = manText(Math.abs(map[it.id] || 0)); await persist(); });
        half.addEventListener('click', async () => { set(-Math.round(it.avg / 2 / 1000) * 1000); ent.input.value = manText(Math.abs(map[it.id] || 0)); await persist(); });
        quick.push(el('div', { class: 'month-nav' }, all, half));
      }
      paint();
      const head = el('button', { type: 'button', class: 'cat-head', 'aria-expanded': 'false' },
        el('span', { class: 'cat-name' }, it.name, el('span', { class: 'cat-sub' }, '기준 ' + formatWon(it.avg))), amtText);
      const body = el('div', { class: 'cat-body', hidden: 'hidden' }, ...(dirs ? [dirs.node] : []), ent.node, steps.node, ...quick,
        it.avg > 0 ? el('p', { class: 'note' }, '기준 ' + formatWon(it.avg) + '까지만 줄일 수 있어요.') : el('p', { class: 'note' }, '기준 기간에 쓰지 않은 분류라서 늘리는 금액만 넣을 수 있어요.'));
      panels.push({ head, body });
      head.addEventListener('click', () => {
        const open = body.hasAttribute('hidden');
        for (const q of panels) { q.body.setAttribute('hidden', 'hidden'); q.head.setAttribute('aria-expanded', 'false'); }
        if (open) { body.removeAttribute('hidden'); head.setAttribute('aria-expanded', 'true'); }
      });
      list2.append(head, body);
    }
    return [el('p', { class: 'note' }, '분류 항목별로 눌러서 앞으로 늘거나 줄 금액을 넣어요.'),
      ...foldBox('넣는 방법', [el('p', { class: 'note' }, '먼저 [늘어요]나 [줄어요]를 고르세요. 그다음 금액을 칸에 직접 쓰거나, [1만 원 늘리기]·[1만 원 줄이기]로 바꾸세요. 줄이는 금액은 기준 금액까지만 넣을 수 있고, 기준 기간에 쓰지 않은 분류도 늘리는 금액은 넣을 수 있어요.')]),
      list2];
  };

  // 달라질 돈 (한 칸): 전체 한번에 / 분류별 중 한 방법만 쓰고, 방법을 바꾸면 이전 값은 0원으로 돌아간다.
  const adjustCard = () => {
    const allBox = el('div', {}), catBox = el('div', {});
    const confirmBox = el('div', { class: 'note warn', role: 'alert', hidden: 'hidden' });
    const labels = { all: '전체 한번에 변경', cat: '분류별로 변경' };
    const pick = {};
    // 단추의 ✓와 보이는 칸은 늘 st.mode와 같아야 한다. 칸을 새로 그리다 문제가 생겨도 단추 표시가 어긋나지 않게, 단추부터 맞춘다.
    const renderPanes = () => {
      for (const k of ['all', 'cat']) {
        const on = st.mode === k;
        pick[k].className = 'btn seg' + (on ? ' on' : ''); pick[k].setAttribute('aria-pressed', String(on)); pick[k].textContent = (on ? '✓ ' : '') + labels[k];
      }
      allBox.hidden = st.mode !== 'all'; catBox.hidden = st.mode !== 'cat';
      for (const [box, build, name] of [[allBox, buildAll, '전체 한번에 변경'], [catBox, buildCat, '분류별로 변경']]) {
        try { box.replaceChildren(...build()); }
        catch (e) { console.error(e); box.replaceChildren(el('p', { class: 'alert', role: 'alert' }, name + ' 칸을 그리지 못했어요. 화면을 닫았다가 다시 열어 주세요.')); }
      }
    };
    const hasValue = () => (st.mode === 'all' ? st.delta !== 0 : Object.keys(st.deltaBy).length > 0);
    const switchTo = async (k) => {
      st.mode = k; st.delta = 0; for (const id of Object.keys(st.deltaBy)) delete st.deltaBy[id];   // 이전 값은 0원으로
      confirmBox.hidden = true; renderPanes(); refresh(); await persist();
    };
    for (const k of ['all', 'cat']) {
      pick[k] = el('button', { type: 'button' }, labels[k]);
      pick[k].addEventListener('click', () => {
        if (st.mode === k) { confirmBox.hidden = true; return; }
        if (!hasValue()) { switchTo(k); return; }
        const was = st.mode === 'all' ? '[전체 한번에 변경] 방식으로 넣은 ' + (st.delta > 0 ? '늘어날 ' : '줄어들 ') + formatWon(Math.abs(st.delta)) : '[분류별로 변경] 방식으로 넣은 ' + Object.keys(st.deltaBy).length + '개 분류의 값';
        const yes = el('button', { type: 'button', class: 'btn' }, '바꿀게요');
        const no = el('button', { type: 'button', class: 'btn' }, '그대로 둘게요');
        yes.addEventListener('click', () => switchTo(k));
        no.addEventListener('click', () => { confirmBox.hidden = true; pick[k].classList.remove('pending'); });
        // 값이 들어 있으면 바로 바꾸지 않고 먼저 묻는다. 누른 단추는 점선 테두리로 "고르는 중"임을 보이고, 확인 상자로 화면을 옮긴다.
        confirmBox.replaceChildren(el('p', {}, '아직 바뀌지 않았어요. ' + was + '은 0원으로 돌아가요. [' + labels[k] + '] 방식으로 바꿀까요?'), el('div', { class: 'month-nav' }, yes, no));
        confirmBox.hidden = false;
        pick[k].classList.add('pending');
        confirmBox.scrollIntoView({ block: 'nearest' });
      });
    }
    // 칸 맨 아래: 기준 생활비 + 늘어날 돈 - 줄어들 돈 = 앞으로 한 달 생활비
    const resBase = el('p', { class: 'meta' });
    const resVal = el('p', { class: 'big-number' });
    onRefresh.push(() => {
      const u = ups(), d = downs();
      resBase.textContent = '기준 ' + formatWon(first.base) + (u ? ' + 늘어날 돈 ' + formatWon(u) : '') + (d ? ' − 줄어들 돈 ' + formatWon(d) : '') + (u || d ? '' : ' (달라지는 돈이 없어요)');
      resVal.textContent = '= ' + formatWon(Math.max(0, first.base + u - d));
    });
    renderPanes();
    return el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, '2. 달라질 생활비 (월간)'),
      el('p', { class: 'meta' }, '기준 생활비와 견주어, 앞으로 달라질 것으로 보는 생활비예요.'),
      el('p', { class: 'meta' }, '예: 여행·병원비·가족 지원은 늘고, 교통비·외식비는 줄 수 있어요'),
      el('p', { class: 'kicker' }, '기준 생활비 (월간 평균)'), el('p', { class: 'big-number' }, formatWon(first.base)),
      el('p', { class: 'kicker' }, '어떻게 바꿀까요?'), el('div', { class: 'month-nav' }, pick.all, pick.cat), confirmBox,
      allBox, catBox,
      el('p', { class: 'kicker' }, '변경 후 생활비 (월간)'), resBase, resVal);
  };
  const changeCard = adjustCard();

  const rateVal = el('p', { class: 'big-number' });
  const rateText = () => (st.rate > 0 ? '연 ' + st.rate + '%' : '넣지 않음');
  const rateEnt = entry('ret-rate', '직접 쓰기', '%', st.rate ? String(st.rate) : '',
    (t) => { st.rate = Math.min(RETIRE_RATE_MAX, Math.round(parseNum(t) * 10) / 10); rateVal.textContent = rateText(); refresh(); },
    async () => { rateEnt.input.value = st.rate ? String(st.rate) : ''; await persist(); });
  const rateChange = async (delta) => {
    st.rate = Math.min(RETIRE_RATE_MAX, Math.max(0, Math.round((st.rate + delta) * 10) / 10));
    rateVal.textContent = rateText(); rateEnt.input.value = st.rate ? String(st.rate) : ''; refresh(); await persist();
  };
  const rLess = el('button', { type: 'button', class: 'btn' }, '0.5% 줄이기');
  const rMore = el('button', { type: 'button', class: 'btn' }, '0.5% 늘리기');
  rLess.addEventListener('click', () => rateChange(-0.5));
  rMore.addEventListener('click', () => rateChange(0.5));
  rateVal.textContent = rateText();
  const rateCard = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '3. 물가 인상 (연간)'), el('p', { class: 'meta' }, '해마다 전년보다 오를 것으로 보는 물가 인상률이에요. 잘 모르면 넣지 않아도 돼요.'),
    rateVal, rateEnt.node, el('div', { class: 'month-nav' }, rLess, rMore),
    ...foldBox('계산 방법', [el('p', { class: 'note' }, '해마다 이 비율만큼 물가가 오른다고 보고, 1년째 금액부터 오른 값으로 계산해요. 오른 금액에 다음 해 인상이 이어서 더해져요(복리). 예: 2.5 → 해마다 2.5%씩 올라요.')]));

  refresh();
  const result = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '4. 미래 생활비 (예상)'),
    el('p', { class: 'meta' }, '위 1~3번을 합쳐 계산한 앞으로의 생활비예요.'),
    el('p', { class: 'kicker' }, '한 달 (지금 물가 기준)'), resultNums.monthly, resultNums.diff, resultNums.warn, resultNums.cmp,
    resultNums.sumKicker, resultNums.yearly, resultNums.five, resultNums.ten, resultNums.later,
    el('p', { class: 'note' }, '세금과 이자는 넣지 않은 단순 계산이며, 투자·금융 자문이 아니에요.'));

  return el('section', {}, el('h1', {}, '미래 생활비 미리보기'), baseCard, changeCard, rateCard, result, ...foot);
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

  // 달마다 한 덩어리로 보여 준다(폰 폭에서도 숫자가 잘리지 않게 표 대신 목록). 기록 없는 달이 이어지면 한 줄로 합친다
  const line = (label, value, cls, rowCls) => el('div', { class: 'pline' + (rowCls ? ' ' + rowCls : '') }, el('span', {}, label), el('span', { class: cls || 'pv' }, value));
  const balLine = (bal) => bal == null ? null
    : bal < 0 ? line('▼ 수입보다 더 쓴 돈', toWon(-bal) + '원', 'pv', 'pbal over') : line('남은 돈', toWon(bal) + '원', 'pv', 'pbal');
  const blocks = [];
  for (let i = 0; i < t.rows.length; i++) {
    const r = t.rows[i];
    if (!r.hasData) {
      let j = i;
      while (j + 1 < t.rows.length && !t.rows[j + 1].hasData) j++;
      const label = j > i ? monthNumber(r.key) + '월~' + monthNumber(t.rows[j].key) + '월' : monthNumber(r.key) + '월';
      blocks.push(el('div', { class: 'pblock' }, el('div', { class: 'phead' }, el('span', { class: 'pm' }, label), el('span', { class: 'meta' }, '기록 없음'))));
      i = j;
      continue;
    }
    blocks.push(el('div', { class: 'pblock' },
      el('div', { class: 'phead' },
        el('span', { class: 'pm' }, monthNumber(r.key) + '월', r.key === nowKey ? el('span', { class: 'ptag' }, '● 진행중') : null),
        el('span', { class: 'pbig' }, toWon(r.expense) + '원')),
      line('여기까지 누적', toWon(r.cumExpense) + '원', 'pv', 'pcum'),
      r.income > 0 ? line('받은 돈', toWon(r.income) + '원') : null,
      balLine(r.balance)));
  }
  const tot = el('div', { class: 'pblock ptotal' },
    el('div', { class: 'phead' }, el('span', { class: 'pm' }, '합계'), el('span', { class: 'pbig' }, toWon(t.total.expense) + '원')),
    t.total.income > 0 ? line('받은 돈', toWon(t.total.income) + '원') : null,
    t.total.balanceMonths > 0 ? balLine(t.total.balance) : null);
  const table = el('div', { class: 'plist' },
    el('p', { class: 'meta' }, from + '월 ~ ' + to + '월 (쓴 돈 기준)'), ...blocks, tot);

  const sum = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, from + '월부터 ' + to + '월까지'),
    statItem('쓴 돈 누적', formatWon(t.total.expense)),
    t.total.income > 0 ? statItem('받은 돈 누적', formatWon(t.total.income)) : null,
    t.total.balanceMonths > 0 ? statItem(t.total.balance >= 0 ? '남은 돈 누적' : '모자란 돈 누적', formatWon(Math.abs(t.total.balance))) : null,
    statSub('한 달 평균', formatWon(t.total.avgExpense)),
    t.total.balanceMonths > 0 && t.total.balanceMonths < t.total.months ? el('p', { class: 'note' }, '남은 돈은 수입을 적은 달(' + t.total.balanceMonths + '개월)만 계산했어요.') : null,
    t.total.months < t.rows.length ? el('p', { class: 'note' }, '기록 없는 달은 합계와 평균에 넣지 않았어요.') : null,
    to === nowM ? el('p', { class: 'note' }, '● 진행 중인 ' + nowM + '월은 오늘까지 쓴 돈이에요. 달이 끝나면 확정돼요.') : null,
    null);

  const pp = mergePay(list.map((x) => x.summary));
  return el('section', {}, el('h1', {}, '기간 선택'), pickCard, el('div', { class: 'card' }, table), sum, payCard(pp.rows, pp.excluded),
    el('p', { class: 'note' }, '단순 계산 기준이며 투자·금융 자문이 아니에요.'),
    el('a', { class: 'btn', href: '#/settle' }, '결산으로'),
    el('a', { class: 'btn', href: '#/home' }, '홈으로'));
}

export async function settleView(ctx, path, params) {
  const { startDay, nowKey, key } = resolveKey(ctx, params);
  const ended = key < nowKey;                          // 끝난 달에서만 신호를 켠다
  const coach = ctx.settings.coachStyle || 'neighbor';

  const categories = await dbGetAll(ctx.db, 'categories');
  const catNameOf = (id) => (categories.find((c) => c.id === id) || {}).name || '';
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
    statItem((ended ? '쓴 돈' : '지금까지 쓴 돈') + (startDay === 1 ? '' : ' (' + range.start.slice(5).replace('-', '/') + ' ~ ' + range.end.slice(5).replace('-', '/') + ')'), formatWon(summary.expense)),
    summary.income > 0
      ? el('div', {},
          statItem('받은 돈', formatWon(summary.income)),
          statItem(summary.balance >= 0 ? '남은 돈' : '모자란 돈', formatWon(Math.abs(summary.balance))))
      : el('p', { class: 'note' }, '수입을 기록하면 남은 돈을 알 수 있어요. [직접 쓰기]에서 [받은 돈]을 고르면 돼요.'),
    summary.transfer > 0 ? el('p', { class: 'note' }, '옮긴 돈(이체) ' + formatWon(summary.transfer) + '은 "쓴 돈"에 넣지 않았어요.') : null,
    summary.reserveDeposit > 0 ? el('p', { class: 'note' }, '쓴 돈에는 미리 떼어 둔 돈 ' + formatWon(summary.reserveDeposit) + '이 들어 있어요.') : null,
    summary.fromReserve > 0 ? el('p', { class: 'note' }, '미리 떼어 둔 돈에서 사용한 ' + formatWon(summary.fromReserve) + '은 "쓴 돈"에 넣지 않았어요. 모을 때 이미 넣었어요.') : null);

  // ---- 월 균형 신호 (끝난 달만) ----
  let balanceCard = null;
  if (ended) {
    const sig = balanceSignal(summary.income, summary.expense);
    if (sig) {
      const [shape, label] = BALANCE_LABEL[sig];
      balanceCard = el('div', { class: 'card sig-' + sig },
        el('p', { class: 'sig-line' }, el('span', { class: 'sig-shape', 'aria-hidden': 'true' }, shape), ' ', label),
        el('p', {}, pickPhrase({ green: 'balanceGreen', yellow: 'balanceYellow', red: 'balanceRed' }[sig], coach, {}, seed)),
        summary.oneoff > 0 ? el('p', { class: 'note' }, '한 번 크게 쓴 일회성 지출이 ' + formatWon(summary.oneoff) + ' 들어 있어요.') : null);
    } else {
      balanceCard = el('div', { class: 'card' }, el('p', {}, pickPhrase('balanceNone', coach, {}, seed)));
    }
  }

  // ---- 남은 돈이 있으면 저금통 안내 (끝난 달만, D112) ----
  const saveCard = (ended && summary.income > 0 && summary.balance > 0)
    ? el('div', { class: 'card' },
        el('p', {}, monthNumber(key) + '월에 남은 돈이 ' + formatWon(summary.balance) + ' 있어요.'),
        el('p', { class: 'note' }, '남은 돈은 [저금통]의 "남은 돈 모음" 칸에 적어 두실 수 있어요.'),
        summary.off.count > 0 ? el('p', { class: 'note' }, '통계에서 뺀 칸의 기록을 빼고 계산한 돈이라 실제 통장에 남은 돈과 다를 수 있어요. 실제로 남아 있을 때만 적어 두세요.') : null,
        el('a', { class: 'btn', href: '#/jar', onclick: () => { ctx.settleBack = key; } }, '저금통으로'))
    : null;

  // ---- 이 달 저금통 (칸별 합계가 아니라 종류별 합계, 모두 0이면 숨김) ----
  // 넣은 돈은 이 달에 저금통에 적어 넣은 금액이고, 쓴 돈은 미리 떼어 둔 돈으로 쓴 기록(fromReserve)이다.
  const moved = await movedByKind(ctx.db, range.start, range.end);
  const movedJars = await movedByJar(ctx.db, range.start, range.end); // MOVED-BY-JAR: 칸별 줄 (마무리한 칸도 보인다)
  const endedMonth = key < nowKey;   // 끝난 달이면 "월말 현재", 이번 달이면 "지금"
  const showReserve = moved.reserve > 0 || movedJars.balanceAtEnd > 0;   // 이 달 기록이 없어도 칸에 남은 돈이 있으면 보인다
  const usedAll = summary.fromReserve + summary.off.used;   // 통계에서 뺀 칸에서 꺼내 사용한 돈도 칸의 실제 움직임이라 이 카드에는 보인다 (D140)
  const jarCard = (moved.reserve + moved.surplus + usedAll) > 0 || showReserve
    ? el('div', { class: 'card' },
        el('h2', { class: 'card-title' }, '이 달 저금통'),
        showReserve ? statItem(monthNumber(key) + '월에 미리 떼어 둔 돈 칸에 넣은 돈', formatWon(moved.reserve)) : null,
        showReserve ? statItem(endedMonth ? monthNumber(key) + '월말 현재 미리 떼어 둔 돈 칸에 남은 돈' : '지금 미리 떼어 둔 돈 칸에 남은 돈', formatWon(movedJars.balanceAtEnd)) : null,
        ...movedJars.jars.map((x) => el('p', { class: 'meta' }, '· ' + x.name + (x.done ? ' (마무리한 칸)' : '') + (x.statsOff ? ' (통계 제외)' : '') + ' ' + formatWon(x.amount))),
        moved.surplus > 0 ? statItem(monthNumber(key) + '월에 남은 돈 모음에 넣은 돈', formatWon(moved.surplus)) : null,
        usedAll > 0 ? statItem(monthNumber(key) + '월에 저금통에서 꺼내 사용한 돈', formatWon(usedAll)) : null,
        el('p', { class: 'note' }, '"넣은 돈"은 이 달에 적은 돈만 더한 숫자이고, "남은 돈"은 모은 돈에서 꺼내 사용한 돈을 뺀 값이에요. ', el('span', { style: 'text-decoration: underline; text-underline-offset: 3px;' }, '마무리한 칸은 [저금통]에 보이지 않아요.'), ' 월말 숫자는 그 달 말일까지 적은 기록으로 계산해서, 다음 달 기록은 들어가지 않아요.'),
        el('p', { class: 'note' }, '이 앱은 실제 돈을 보관하지 않아요. 적어 둔 기록이에요.'),
        el('a', { class: 'btn', href: '#/jar', onclick: () => { ctx.settleBack = key; } }, '저금통으로'))
    : null;

  // ---- 고정비·변동비·일회성 (줄마다 [펴기 ▼]로 그 구분의 기록을 바로 본다, 2026-11-06) ----
  const kindRows = { fixed: [], variable: [], oneoff: [] };
  for (const r of rows) { if (r.type === 'expense' && !r.fromReserve && !r.statsOff) kindRows[KIND_OF(r)].push(r); }
  const kindTotal = summary.fixed + summary.variable + summary.oneoff;
  const kindMax = Math.max(summary.fixed, summary.variable, summary.oneoff);
  const kindRow = (kind, label, amount) => {
    const list = kindRows[kind];
    const extra = list.length > 0 ? foldBox(label.split(' (')[0] + ' 세부 내역', [kindDetail(list, kind, key, catNameOf)]) : [];
    return barRow({ name: label, amount, count: list.length, total: kindTotal, max: kindMax, extra });
  };
  const kinds = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '어떤 돈이 나갔나요'),
    kindRow('fixed', KIND_LABEL.fixed, summary.fixed),
    kindRow('variable', KIND_LABEL.variable, summary.variable),
    kindRow('oneoff', KIND_LABEL.oneoff, summary.oneoff),
    kindTotal > 0 ? el('p', { class: 'meta' }, '퍼센트는 쓴 돈 합계에서 차지하는 몫이고, 반올림한 값이에요.') : null);

  // ---- 분류별 순위 (위 5개와 나머지) ----
  const top = summary.byCategory.slice(0, 5);
  const restGroups = summary.byCategory.slice(5);
  const restSum = restGroups.reduce((a, g) => a + g.amount, 0);
  const max = top.length ? top[0].amount : 1;
  const catTotal = summary.byCategory.reduce((a, g) => a + g.amount, 0);
  const bar = (name, amount, signalNode, count) => barRow({ name, amount, count, total: catTotal, max, signal: signalNode });
  const catSignal = (g) => {
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
    return node;
  };
  const ranking = el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '어디에 많이 썼나요'),
    summary.byCategory.length === 0 ? el('p', { class: 'meta' }, '쓴 돈 기록이 없어요.') : null,
    top.map((g) => bar(g.name, g.amount, catSignal(g), g.count)),
    restGroups.length > 0 ? bar('나머지 ' + restGroups.length + '개 분류', restSum, null, restGroups.reduce((a, g) => a + g.count, 0)) : null,
    restGroups.length > 0 ? restFold(restGroups.length, restGroups.map((g) => bar(g.name, g.amount, catSignal(g), g.count))) : null,
    catTotal > 0 && !(kindTotal > 0) ? el('p', { class: 'meta' }, '퍼센트는 쓴 돈 합계에서 차지하는 몫이고, 반올림한 값이에요.') : null);

  // ---- 말풀이 (늘어난 항목 1~2개) ----
  const talk = el('div', { class: 'card' }, el('h2', { class: 'card-title' }, '평소와 비교'));
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
        talk.append(compareItem(r, baseline.months, monthNumber(key)));
      }
    }
    talk.append(...foldBox('기준', [el('div', { class: 'card basis' },
      el('p', { class: 'meta' }, '평균을 낸 달: ' + baseline.keys.slice().sort().map((k) => monthNumber(k) + '월').join(', ')),
      el('p', { class: 'note' }, '평균과 이달 금액 모두 필수 지출, 일회성 지출, 응원 소비는 뺀 값이에요.'))]));
  }

  const offCard = summary.off.count > 0
    ? el('div', { class: 'card' },
        el('p', {}, '통계에서 뺀 칸의 기록 ' + summary.off.count + '건('
          + [summary.off.deposit > 0 ? '저금한 돈 ' + formatWon(summary.off.deposit) : '', summary.off.used > 0 ? '꺼내 사용한 돈 ' + formatWon(summary.off.used) : ''].filter(Boolean).join(', ')
          + ')은 위 "쓴 돈"과 아래 "평소와 비교"에 넣지 않았어요.'),
        el('p', { class: 'note' }, '기록은 지워지지 않고 내역에 그대로 있어요.'),
        el('a', { class: 'btn', href: '#/settle/' + key + '/excluded' }, '통계에서 뺀 칸 보기'))
    : null;

  return el('section', {}, ...head, hello, totals, offCard, balanceCard, saveCard, foldCard(kinds, true), foldCard(ranking, true), foldCard(payCard(summary.byPay, summary.payExcluded), false), foldCard(jarCard, false), foldCard(talk, false),
    el('p', { class: 'note' }, '단순 계산 기준이며 투자·금융 자문이 아니에요.'),


    el('a', { class: 'btn', href: '#/history/' + key, onclick: () => { ctx.settleBack = key; } }, '내역 보기'),
    el('a', { class: 'btn', href: '#/home' }, '홈으로'));
}

// 결산 세부 내역: 고정비·변동비·일회성 한 가지에 들어 있는 쓴 돈 기록을 목록으로 보인다 (D139).
// 합계는 월 결산 카드의 숫자와 같은 기준(미리 떼어 둔 돈으로 쓴 기록과 이체는 뺀다, 저금통 적립은 쓴 돈이라 넣는다)이다.
export async function kindListView(ctx, path, params) {
  if (params.kind === 'excluded') return statsOffView(ctx, params);   // 통계에서 뺀 칸 목록 (D140)
  const { startDay, nowKey, key } = resolveKey(ctx, params);
  const kind = ['fixed', 'variable', 'oneoff'].includes(params.kind) ? params.kind : 'fixed';
  const categories = await dbGetAll(ctx.db, 'categories');
  const nameOf = (id) => (categories.find((c) => c.id === id) || {}).name || '';
  const box = el('section', {});

  const paint = async () => {
    const rows = (await listTransactionsByPeriod(ctx.db, key, startDay))
      .filter((r) => r.type === 'expense' && !r.fromReserve && !r.statsOff && KIND_OF(r) === kind);
    const total = rows.reduce((a, r) => a + r.amount, 0);
    const list = [...rows].sort(kindSort === 'date'
      ? (a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1)
      : (a, b) => b.amount - a.amount || (a.date < b.date ? 1 : -1));
    const hasDeposit = rows.some((r) => r.reserveDeposit);

    const sortBtn = (id, label) => {
      const on = kindSort === id;
      const b = el('button', { type: 'button', class: 'btn seg' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false' }, (on ? '✓ ' : '') + label);
      b.addEventListener('click', () => { kindSort = id; paint(); });
      return b;
    };
    const items = list.map((r) => {
      const title = r.reserveDeposit ? '저금통' : (nameOf(r.categoryId) || '기타');
      const tag = r.reserveDeposit
        ? ['[', el('span', { style: 'color:#ffffff; background:#1b5e20; font-weight: 800; padding: 0 4px; border-radius: 3px;' }, '지출 적립'), '] ']
        : null;
      const sub = [r.merchant, r.memo].filter(Boolean).join(' · ');
      return el('a', { class: 'item', href: '#/edit/' + r.id + '/kind-' + kind + '-' + key },
        el('div', { class: 'item-main' },
          el('div', { class: 'item-line' },
            el('p', { class: 'item-title' }, tag, title),
            el('p', { class: 'item-amount' }, formatWon(r.amount))),
          el('p', { class: 'meta' }, formatDateKo(r.date)),
          r.reserveDeposit ? el('p', { class: 'meta' }, '미리 떼어 둔 돈') : null,
          sub ? el('p', { class: 'meta' }, sub) : null));
    });
    const back = el('a', { class: 'btn', href: '#/settle/' + key }, Number(key.slice(5)) + '월 결산으로');
    box.replaceChildren(...[
      el('h1', {}, '결산'),
      el('h2', { class: 'period' }, periodTitle(key)),
      el('div', { class: 'card' },
        el('p', { class: 'kicker' }, KIND_LABEL[kind]),
        el('p', { class: 'big-number' }, formatWon(total)),
        el('p', { class: 'meta' }, rows.length + '건'),
        hasDeposit ? el('p', { class: 'note' }, '미리 떼어 둔 돈으로 저금통에 넣은 "지출 적립" 기록도 "쓴 돈"에 들어 있어서 함께 보여요.') : null,
        key === nowKey ? el('p', { class: 'note' }, '이번 달은 아직 지나는 중이라 더 늘 수 있어요.') : null),
      rows.length > 0 ? el('div', { class: 'month-nav' }, sortBtn('amount', '금액순'), sortBtn('date', '날짜순')) : null,
      rows.length === 0 ? el('div', { class: 'card' }, el('p', {}, '이 구분에 해당하는 기록이 없어요.')) : null,
      ...items,
      rows.length > 0 ? el('p', { class: 'note' }, '기록을 누르면 고칠 수 있어요. 구분이 잘못 들어갔다면 "기록 고치기" 화면에서 바꿔 주세요.') : null,
      back,
    ].filter(Boolean));
  };
  await paint();
  return box;
}

// 통계에서 뺀 칸 목록: 칸마다 [통계에 다시 넣기]로 되돌린다 (D140). 주소의 달은 [N월 결산으로]가 돌아갈 결산 달이다.
async function statsOffView(ctx, params) {
  const { key } = resolveKey(ctx, params);
  const box = el('section', {});
  let msg = '';
  const paint = async () => {
    const jars = await listStatsOffJars(ctx.db);
    const items = jars.map((j) => {
      const btn = el('button', { type: 'button', class: 'btn' }, '통계에 다시 넣기');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { await setJarStatsOff(ctx.db, j.id, false); msg = '"' + j.name + '" 칸을 통계에 다시 넣었어요.'; }
        catch (e) { console.error(e); msg = e.userMessage || '바꾸지 못했어요. 한 번 더 눌러 주세요.'; }
        await paint();
      });
      return el('div', { class: 'card' },
        el('p', { class: 'kicker' }, j.name + (j.done ? ' (마무리한 칸)' : '') + (j.deleted ? ' (지운 칸)' : '')),
        el('div', { class: 'row' }, el('p', {}, '저금한 돈'), el('p', { class: 'row-value' }, formatWon(j.moved))),
        el('div', { class: 'row' }, el('p', {}, '꺼내 사용한 돈'), el('p', { class: 'row-value' }, formatWon(j.used))),
        btn);
    });
    box.replaceChildren(...[
      el('h1', {}, '통계에서 뺀 칸'),
      el('p', { class: 'note' }, '여기 있는 칸의 저금·사용한 기록은 결산의 "쓴 돈"과 "평소와 비교", 신호등에 넣지 않아요. 기록과 칸의 돈은 그대로예요.'),
      msg ? el('div', { class: 'banner', role: 'status' }, el('span', {}, msg)) : null,
      jars.length === 0 ? el('div', { class: 'card' }, el('p', {}, '통계에서 뺀 칸이 없어요.')) : null,
      ...items,
      el('a', { class: 'btn', href: '#/settle/' + key }, Number(key.slice(5)) + '월 결산으로'),
    ].filter(Boolean));
  };
  await paint();
  return box;
}

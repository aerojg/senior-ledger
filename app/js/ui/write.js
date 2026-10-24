// S4 직접 쓰기(금액 -> 분류 -> 확인 3단계)와 S5 기록 완료 (화면흐름 v1.0)
// 한 화면에 질문 하나, 주된 큰 버튼 하나 (U1). 길게 누르기·밀기 같은 숨은 동작은 쓰지 않는다 (U6).
import { el } from './dom.js';
import { formatWon, koreanAmount, formatDateKo } from './format.js';
import { makeAmountField } from './amountField.js';
import { todayStr, yesterdayStr } from '../storage/dates.js';
import { dbGetAll } from '../storage/db.js';
import { addTransaction, softDeleteTransaction, listFrequentPairs } from '../storage/transactions.js';

const PAY_METHODS = [
  ['cash', '현금'], ['debit', '체크카드'], ['credit', '신용카드'],
  ['account', '계좌로 보냄'], ['pay', '간편결제'], ['etc', '기타'],
];

function newDraft() {
  return { amount: 0, date: todayStr(), categoryId: '', memo: '', payMethod: 'cash' };
}

async function expenseCategories(ctx) {
  const all = await dbGetAll(ctx.db, 'categories');
  return all.filter((c) => c.kind === 'expense' && c.isActive).sort((a, b) => a.order - b.order);
}

function backLink(href, text = '뒤로') {
  return el('a', { class: 'btn', href }, text);
}

// ---------- 1단계: 얼마 쓰셨나요? ----------
export async function writeStep1(ctx, path) {
  if (path === '/write') {            // 홈에서 새로 들어옴: 새 초안으로 시작
    ctx.draft = newDraft();
    history.replaceState(null, '', '#/write/1');   // 뒤로 가기로 돌아와도 입력이 남도록
  }
  if (!ctx.draft) ctx.draft = newDraft();
  const draft = ctx.draft;

  const categories = await expenseCategories(ctx);
  const nameOf = (id) => (categories.find((c) => c.id === id) || {}).name || '';
  const frequent = (await listFrequentPairs(ctx.db)).filter((f) => nameOf(f.categoryId));

  const hint = el('p', { class: 'muted hint' });
  const next = el('a', { class: 'btn primary', href: '#/write/2' }, '다음');
  const amountField = makeAmountField({
    initial: draft.amount,
    onChange: (amount) => { draft.amount = amount; refresh(); },
  });
  const input = amountField.input;
  const reading = amountField.reading;

  function refresh() {
    const ok = draft.amount >= 1;
    next.classList.toggle('disabled', !ok);
    next.setAttribute('aria-disabled', ok ? 'false' : 'true');
    hint.textContent = ok ? '' : '금액을 입력하면 다음으로 갈 수 있어요.';
  }
  next.addEventListener('click', (e) => { if (draft.amount < 1) { e.preventDefault(); input.focus(); } });

  // 오늘 / 어제 선택 (선택된 쪽에는 ✓를 붙여 색만으로 구분하지 않는다, U5)
  const dateButtons = [['오늘', todayStr()], ['어제', yesterdayStr()]].map(([label, value]) => {
    const b = el('button', { type: 'button', class: 'btn seg' });
    const paint = () => {
      const on = draft.date === value;
      b.textContent = (on ? '✓ ' : '') + label + ' ' + formatDateKo(value);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    b.addEventListener('click', () => { draft.date = value; dateButtons.forEach((x) => x.paint()); });
    b.paint = paint;
    paint();
    return b;
  });

  const frequentBox = frequent.length === 0 ? null : el('div', { class: 'card' },
    el('h2', {}, '자주 쓰는 것'),
    el('p', { class: 'muted' }, '누르면 바로 확인 화면으로 가요.'),
    frequent.map((f) => el('button', {
      type: 'button', class: 'btn',
      onclick: () => {
        draft.amount = f.amount; draft.categoryId = f.categoryId;
        location.hash = '#/write/3';
      },
    }, nameOf(f.categoryId) + ' ' + formatWon(f.amount))));

  refresh();
  setTimeout(() => input.focus(), 0);
  return el('section', {},
    el('h1', {}, '얼마 쓰셨나요?'),
    frequentBox,
    el('label', { for: 'amount', class: 'label' }, '금액 (원)'),
    input, reading,
    el('p', { class: 'label' }, '언제 쓰셨나요?'),
    dateButtons,
    hint,
    next,
    backLink('#/home', '홈으로'),
  );
}

// ---------- 2단계: 어디에 쓰셨나요? ----------
export async function writeStep2(ctx) {
  const draft = ctx.draft;
  if (!draft || draft.amount < 1) { location.replace('#/write/1'); return el('section'); }

  const categories = await expenseCategories(ctx);
  const main = categories.slice(0, 6);
  const rest = categories.slice(6);
  let showMore = false;

  const grid = el('div', { class: 'grid2' });
  const moreBtn = el('button', { type: 'button', class: 'btn' });

  function pick(c) {
    draft.categoryId = c.id;
    location.hash = '#/write/3';
  }
  function paint() {
    const list = showMore ? categories : main;
    grid.replaceChildren(...list.map((c) =>
      el('button', { type: 'button', class: 'btn cat' + (draft.categoryId === c.id ? ' on' : ''), onclick: () => pick(c) },
        (draft.categoryId === c.id ? '✓ ' : '') + c.name)));
    moreBtn.textContent = showMore ? '접기' : '더보기';
    moreBtn.hidden = rest.length === 0;
  }
  moreBtn.addEventListener('click', () => { showMore = !showMore; paint(); });
  paint();

  return el('section', {},
    el('h1', {}, '어디에 쓰셨나요?'),
    el('p', { class: 'muted' }, formatWon(draft.amount) + ' · ' + formatDateKo(draft.date)),
    grid,
    moreBtn,
    backLink('#/write/1'),
  );
}

// ---------- 3단계: 맞나요? ----------
export async function writeStep3(ctx) {
  const draft = ctx.draft;
  if (!draft || draft.amount < 1) { location.replace('#/write/1'); return el('section'); }
  if (!draft.categoryId) { location.replace('#/write/2'); return el('section'); }

  const categories = await expenseCategories(ctx);
  const category = categories.find((c) => c.id === draft.categoryId);
  if (!category) { location.replace('#/write/2'); return el('section'); }

  const memo = el('input', { id: 'memo', class: 'input', type: 'text', maxlength: '60', autocomplete: 'off', value: draft.memo });
  memo.addEventListener('input', () => { draft.memo = memo.value; });

  const pay = el('select', { id: 'pay', class: 'input' },
    PAY_METHODS.map(([value, label]) => el('option', { value, selected: draft.payMethod === value }, label)));
  pay.addEventListener('change', () => { draft.payMethod = pay.value; });

  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const save = el('button', { type: 'button', class: 'btn primary' }, '기록하기');
  save.addEventListener('click', async () => {
    save.disabled = true;
    alertBox.hidden = true;
    try {
      const record = await addTransaction(ctx.db, {
        date: draft.date, amount: draft.amount, categoryId: draft.categoryId,
        memo: draft.memo.trim(), payMethod: draft.payMethod, source: 'manual',
      });
      ctx.lastSaved = { id: record.id, amount: record.amount, date: record.date, categoryName: category.name };
      ctx.draft = null;
      location.hash = '#/done';
    } catch (e) {
      alertBox.textContent = e.userMessage || '기록하지 못했어요. 한 번 더 눌러 주세요.';
      alertBox.hidden = false;
      save.disabled = false;
    }
  });

  const row = (label, value, href, sub) => el('div', { class: 'row' },
    el('div', {}, el('p', { class: 'muted small' }, label), el('p', { class: 'row-value' }, value),
      sub ? el('p', { class: 'muted small' }, sub) : null),
    el('a', { class: 'link-btn', href }, '바꾸기'));

  return el('section', {},
    el('h1', {}, '맞나요?'),
    el('div', { class: 'card' },
      row('금액', formatWon(draft.amount), '#/write/1', koreanAmount(draft.amount)),
      row('날짜', formatDateKo(draft.date), '#/write/1'),
      row('어디에 쓰셨나요', category.name, '#/write/2')),
    el('label', { for: 'pay', class: 'label' }, '어떻게 내셨나요?'), pay,
    el('label', { for: 'memo', class: 'label' }, '메모 (없으면 비워 두세요)'), memo,
    alertBox,
    save,
    backLink('#/write/2'),
  );
}

// ---------- S5 기록 완료 ----------
export async function doneView(ctx) {
  const saved = ctx.lastSaved;
  if (!saved) { location.replace('#/home'); return el('section'); }

  const box = el('section', {});
  function showDone() {
    const cancelBtn = el('button', { type: 'button', class: 'btn' }, '방금 기록 취소');
    cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      try {
        await softDeleteTransaction(ctx.db, saved.id);
        ctx.lastSaved = null;
        showCancelled();
      } catch (e) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = '취소하지 못했어요. 다시 눌러 주세요';
      }
    });
    box.replaceChildren(
      el('div', { class: 'check', 'aria-hidden': 'true' }, '✓'),
      el('h1', { class: 'center' }, '기록했어요'),
      el('p', { class: 'center' }, saved.categoryName + ' ' + formatWon(saved.amount) + ' · ' + formatDateKo(saved.date)),
      el('a', { class: 'btn primary', href: '#/write' }, '하나 더 기록하기'),
      el('a', { class: 'btn', href: '#/home' }, '홈으로'),
      cancelBtn,
    );
  }
  function showCancelled() {
    box.replaceChildren(
      el('h1', { class: 'center' }, '기록을 취소했어요'),
      el('p', { class: 'center muted' }, '방금 쓴 기록은 합계에 들어가지 않아요.'),
      el('a', { class: 'btn primary', href: '#/write' }, '다시 기록하기'),
      el('a', { class: 'btn', href: '#/home' }, '홈으로'),
    );
  }
  showDone();
  return box;
}

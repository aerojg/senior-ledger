/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// S4 직접 쓰기(금액 -> 분류 -> 확인 3단계)와 S5 기록 완료 (화면흐름 v1.0)
// 한 화면에 질문 하나, 주된 큰 버튼 하나 (U1). 길게 누르기·밀기 같은 숨은 동작은 쓰지 않는다 (U6).
import { doneStamps } from './stamps.js'; // EFFECTS-ENTRY
import { recordEffects } from './effects.js'; // EFFECTS-ENTRY
import { cheerFor } from '../storage/cheer.js'; // CHEER-ENTRY
import { el } from './dom.js';
import { formatWon, koreanAmount, formatDateKo } from './format.js';
import { makeAmountField } from './amountField.js';
import { todayStr, yesterdayStr } from '../storage/dates.js';
import { dbGetAll } from '../storage/db.js';
import { categoryMakePanel, userActiveCount, MAX_USER_CATEGORIES } from './categoryMake.js'; // CATEGORY-MAKE-ENTRY
import { addTransaction, softDeleteTransaction, listFrequentPairs } from '../storage/transactions.js';
import { listJars, listEntries, sumEntries } from '../storage/jars.js'; // JAR-CHOICE-ENTRY
import { useJar, undoUse } from '../storage/jarUse.js'; // JAR-CHOICE-ENTRY

export const PAY_METHODS = [
  ['cash', '현금'], ['debit', '체크카드'], ['credit', '신용카드'],
  ['account', '계좌이체'], ['pay', '간편결제'], ['etc', '기타'],
];

// 받은 돈(수입)은 어떻게 받았는지만 묻는다 (직접 쓰기의 받은 돈, Q37)
export const INCOME_PAY_METHODS = [['account', '통장으로 받음'], ['cash', '현금'], ['etc', '기타']];

function newDraft() {
  return { kind: 'expense', amount: 0, date: todayStr(), categoryId: '', memo: '', payMethod: 'cash', jarId: '' };
}

// kind: 'expense'(쓴 돈) 또는 'income'(받은 돈)
async function categoriesOf(ctx, kind) {
  const all = await dbGetAll(ctx.db, 'categories');
  return all.filter((c) => c.kind === kind && c.isActive).sort((a, b) => a.order - b.order);
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
  if (!draft.kind) draft.kind = 'expense';

  const categories = await categoriesOf(ctx, 'expense');
  const nameOf = (id) => (categories.find((c) => c.id === id) || {}).name || '';
  const frequent = (await listFrequentPairs(ctx.db)).filter((f) => nameOf(f.categoryId));

  const hint = el('p', { class: 'muted hint' });
  const next = el('a', { class: 'btn primary', href: '#/write/2' }, '다음');
  const amountField = makeAmountField({
    initial: draft.amount,
    onChange: (amount) => { if (draft.amount !== amount) draft.jarId = ''; draft.amount = amount; refresh(); },   // 금액이 바뀌면 칸 선택은 처음으로 (JAR-CHOICE-ENTRY)
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
    el('p', { class: 'note' }, '누르면 바로 확인 화면으로 가요.'),
    frequent.map((f) => el('button', {
      type: 'button', class: 'btn',
      onclick: () => {
        draft.kind = 'expense'; draft.payMethod = 'cash';
        draft.amount = f.amount; draft.categoryId = f.categoryId; draft.jarId = '';
        location.hash = '#/write/3';
      },
    }, nameOf(f.categoryId) + ' ' + formatWon(f.amount))));

  // 쓴 돈 / 받은 돈 선택 (선택된 쪽에는 ✓를 붙인다, U5)
  const title = el('h1', {});
  const dateLabel = el('p', { class: 'label' });
  const kindButtons = [['expense', '쓴 돈'], ['income', '받은 돈']].map(([value, label]) => {
    const b = el('button', { type: 'button', class: 'btn seg' });
    b.paint = () => {
      const on = draft.kind === value;
      b.textContent = (on ? '✓ ' : '') + label;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    b.addEventListener('click', () => {
      if (draft.kind === value) return;
      draft.kind = value;
      draft.categoryId = '';                       // 분류 목록이 달라지므로 비운다
      draft.jarId = '';
      draft.payMethod = value === 'income' ? 'account' : 'cash';
      paintKind();
    });
    return b;
  });
  function paintKind() {
    const income = draft.kind === 'income';
    title.textContent = income ? '얼마 받으셨나요?' : '얼마 쓰셨나요?';
    dateLabel.textContent = income ? '언제 받으셨나요?' : '언제 쓰셨나요?';
    if (frequentBox) frequentBox.hidden = income;
    kindButtons.forEach((b) => b.paint());
  }
  paintKind();

  refresh();
  setTimeout(() => input.focus(), 0);
  const peek = ctx.peekText
    ? el('div', { class: 'card' },
        el('p', { class: 'kicker' }, '붙여 넣은 글 (보면서 쓰세요. 저장하지 않아요)'),
        el('div', { class: 'peek' }, ctx.peekText))
    : null;

  return el('section', {},
    title,
    el('p', { class: 'label' }, '무슨 돈인가요?'),
    kindButtons,
    peek,
    frequentBox,
    el('label', { for: 'amount', class: 'label' }, '금액 (원)'),
    input, reading,
    dateLabel,
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

  const income = draft.kind === 'income';
  const categories = await categoriesOf(ctx, draft.kind || 'expense');
  const hiddenCount = (await dbGetAll(ctx.db, 'categories')).filter((c) => c.kind === (draft.kind || 'expense') && c.isActive === false).length;
  const main = income ? categories : categories.slice(0, 6);   // 받은 돈은 3개뿐이라 전부 보인다
  const rest = income ? [] : categories.slice(6);
  let showMore = false;

  // 새 분류 만들기 (쓴 돈만): [▼ 분류 더보기]를 펼쳤을 때만 접기 줄과 뒤로 버튼 사이에 보인다.
  // 누르면 이 화면이 만들기 화면으로 바뀌고, 만들면 바로 그 분류로 확인 화면에 간다 (CATEGORY-MAKE-ENTRY)
  let makeBox = null;
  if (!income) {
    const mine = userActiveCount(await dbGetAll(ctx.db, 'categories'));
    makeBox = mine >= MAX_USER_CATEGORIES
      ? el('p', { class: 'note' }, '내가 만든 분류는 ' + MAX_USER_CATEGORIES + '개까지 만들 수 있어요. 쓰지 않는 분류를 숨기면 새로 만들 수 있어요.')
      : el('button', { type: 'button', class: 'btn', onclick: () => openMake() }, '+ 새 분류 만들기');
  }

  const grid = el('div', { class: 'grid2' });
  const moreBtn = el('button', { type: 'button', class: 'btn sub' });

  function pick(c) {
    draft.categoryId = c.id;
    location.hash = '#/write/3';
  }
  function paint() {
    const list = showMore ? categories : main;
    grid.replaceChildren(...list.map((c) =>
      el('button', { type: 'button', class: 'btn cat' + (draft.categoryId === c.id ? ' on' : ''), onclick: () => pick(c) },
        (draft.categoryId === c.id ? '✓ ' : '') + c.name)));
    moreBtn.textContent = showMore ? '▲ 접기' : '▼ 분류 더보기';
    moreBtn.hidden = rest.length === 0;
    if (makeBox) makeBox.hidden = rest.length > 0 && !showMore;   // 더보기가 없을 만큼 분류를 숨겼다면 늘 보인다
  }
  moreBtn.addEventListener('click', () => { showMore = !showMore; paint(); });
  paint();

  const view = el('section', {});
  const mainNodes = [
    el('h1', {}, income ? '어떤 돈인가요?' : '어디에 쓰셨나요?'),
    el('p', { class: 'meta' }, (income ? '받은 돈 ' : '') + formatWon(draft.amount) + ' · ' + formatDateKo(draft.date)),
    grid,
    moreBtn,
    makeBox,
    hiddenCount > 0 ? el('div', { class: 'note' },
      el('p', {}, '숨긴 분류가 ' + hiddenCount + '개 있어요. 찾는 분류가 안 보이면 다시 보이게 할 수 있어요.'),
      el('a', { class: 'btn', href: '#/categories', onclick: () => { ctx.catBack = '#/write/2'; } }, '숨긴 분류 다시 보이게 하기')) : null,
    backLink('#/write/1'),
  ].filter(Boolean);
  function showMain() { view.replaceChildren(...mainNodes); window.scrollTo(0, 0); }
  function openMake() {
    view.replaceChildren(categoryMakePanel(ctx, {
      onDone: (cat) => { draft.categoryId = cat.id; location.hash = '#/write/3'; },
      onCancel: showMain,
    }));
  }
  view.replaceChildren(...mainNodes);
  return view;
}

// ---------- 3단계: 맞나요? ----------
export async function writeStep3(ctx) {
  const draft = ctx.draft;
  if (!draft || draft.amount < 1) { location.replace('#/write/1'); return el('section'); }
  if (!draft.categoryId) { location.replace('#/write/2'); return el('section'); }

  const income = draft.kind === 'income';
  const categories = await categoriesOf(ctx, draft.kind || 'expense');
  const category = categories.find((c) => c.id === draft.categoryId);
  if (!category) { location.replace('#/write/2'); return el('section'); }

  const memo = el('input', { id: 'memo', class: 'input', type: 'text', maxlength: '60', autocomplete: 'off', value: draft.memo });
  memo.addEventListener('input', () => { draft.memo = memo.value; });

  const pay = el('select', { id: 'pay', class: 'input' },
    (income ? INCOME_PAY_METHODS : PAY_METHODS).map(([value, label]) => el('option', { value, selected: draft.payMethod === value }, label)));
  pay.addEventListener('change', () => { draft.payMethod = pay.value; });

  // 저금통에 모은 돈으로 쓴 경우 (Q56, 화면흐름 S4 3번): 쓴 돈에서만, 쓸 수 있는 돈이 남은 칸이 있을 때만 보인다. JAR-CHOICE-ENTRY
  let jarChoices = [];
  if (!income) {
    try {
      for (const jar of await listJars(ctx.db)) {
        if (jar.status === 'done') continue;
        const balance = sumEntries(await listEntries(ctx.db, jar.id)).balance;
        if (balance > 0) jarChoices.push({ jar, balance });
      }
    } catch (e) { console.error(e); jarChoices = []; }
  }
  // 고른 칸이 없어졌거나 모은 돈이 지금 금액보다 모자라면 선택을 처음으로 되돌린다
  if (!jarChoices.some((c) => c.jar.id === draft.jarId && c.balance >= draft.amount)) draft.jarId = '';
  const jarSelect = jarChoices.length === 0 ? null : el('select', { id: 'jarpick', class: 'input' },
    el('option', { value: '' }, '아니에요'),
    ...jarChoices.map((c) => el('option', { value: c.jar.id }, c.jar.name + ' 칸에서 썼어요 (모은 돈 ' + formatWon(c.balance) + ')')));
  if (jarSelect) {
    jarSelect.value = draft.jarId;               // 처음 값은 "아니에요", 뒤로 갔다 오면 고른 칸이 남는다
    jarSelect.addEventListener('change', () => { draft.jarId = jarSelect.value; });
  }

  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const save = el('button', { type: 'button', class: 'btn primary' }, '기록하기');
  save.addEventListener('click', async () => {
    save.disabled = true;
    alertBox.hidden = true;
    try {
      let jarUse = null;                           // JAR-CHOICE-ENTRY: 저금통 칸에서 쓴 돈이면 칸의 기록과 함께 남긴다
      let record;
      if (!income && draft.jarId) {
        jarUse = await useJar(ctx.db, { jarId: draft.jarId, categoryId: draft.categoryId, amount: draft.amount, date: draft.date });
        record = jarUse.transaction;
      } else {
        record = await addTransaction(ctx.db, {
          type: income ? 'income' : 'expense',
          date: draft.date, amount: draft.amount, categoryId: draft.categoryId,
          memo: draft.memo.trim(), payMethod: draft.payMethod, source: 'manual',
        });
      }
      ctx.lastSaved = { id: record.id, type: record.type, amount: record.amount, date: record.date, categoryName: category.name, jarUse };
      ctx.draft = null;
      ctx.peekText = null;
      location.hash = '#/done';
    } catch (e) {
      alertBox.textContent = e.userMessage || '기록하지 못했어요. 한 번 더 눌러 주세요.';
      alertBox.hidden = false;
      save.disabled = false;
    }
  });

  const row = (label, value, href, sub) => el('div', { class: 'row' },
    el('div', {}, el('p', { class: 'kicker' }, label), el('p', { class: 'row-value' }, value),
      sub ? el('p', { class: 'meta' }, sub) : null),
    el('a', { class: 'link-btn', href }, '바꾸기'));

  return el('section', {},
    el('h1', {}, '맞나요?'),
    el('div', { class: 'card' },
      row(income ? '받은 돈' : '금액', formatWon(draft.amount), '#/write/1', koreanAmount(draft.amount)),
      row('날짜', formatDateKo(draft.date), '#/write/1'),
      row(income ? '어떤 돈인가요' : '어디에 쓰셨나요', category.name, '#/write/2')),
    el('label', { for: 'pay', class: 'label' }, income ? '어떻게 받으셨나요?' : '어떻게 쓰셨나요?'), pay,
    el('label', { for: 'memo', class: 'label' }, '메모 (없으면 비워 두세요)'), memo,
    ...(jarSelect ? [
      el('label', { for: 'jarpick', class: 'label' }, '저금통에 모은 돈으로 쓰셨나요?'), jarSelect,
      el('p', { class: 'note' }, '칸을 고르면 그 칸의 모은 돈에서 빠져요. 이때는 메모와 결제 방법은 남기지 않아요.'),
    ] : []), // JAR-CHOICE-ENTRY
    alertBox,
    save,
    backLink('#/write/2'),
  );
}

// ---------- S5 기록 완료 ----------
export async function doneView(ctx) {
  const saved = ctx.lastSaved;
  if (!saved) { location.replace('#/home'); return el('section'); }

  const cheer = await cheerFor(ctx.db, ctx.settings, saved); // CHEER-ENTRY: 설정이 꺼져 있거나 하루 2번을 넘으면 비어 있다
  const stampEl = await doneStamps(ctx); // EFFECTS-ENTRY: 이번 주 도장판(S5 2번), 실패하면 비어 있다
  const box = el('section', {});
  function showDone() {
    const many = !!saved.batchCount;
    const cancelBtn = el('button', { type: 'button', class: 'btn' }, many ? '방금 기록 모두 취소 (' + saved.batchCount + '건)' : '방금 기록 취소');
    cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      try {
        if (saved.jarUse) await undoUse(ctx.db, saved.jarUse); // JAR-CHOICE-ENTRY: 칸의 기록도 함께 되돌린다
        else for (const id of (saved.ids || [saved.id])) await softDeleteTransaction(ctx.db, id);
        ctx.lastSaved = null;
        showCancelled();
      } catch (e) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = '취소하지 못했어요. 다시 눌러 주세요';
      }
    });
    box.replaceChildren(
      el('div', { class: 'check', 'aria-hidden': 'true' }, '✓'),
      el('h1', { class: 'center' }, many ? saved.batchCount + '건을 기록했어요' : '기록했어요'),
      el('p', { class: 'center' }, many ? saved.summary : (saved.type === 'income' ? '받은 돈 · ' : '') + saved.categoryName + ' ' + formatWon(saved.amount) + ' · ' + formatDateKo(saved.date)),
      ...(cheer ? [el('p', { class: 'center' }, cheer)] : []), // CHEER-ENTRY
      ...(stampEl ? [stampEl] : []), // EFFECTS-ENTRY
      many
        ? el('a', { class: 'btn primary', href: '#/sms' }, '문자 더 붙여넣기')
        : el('a', { class: 'btn primary', href: '#/write' }, '하나 더 기록하기'),
      el('a', { class: 'btn', href: '#/home' }, '홈으로'),
      el('a', { class: 'btn', href: '#/exit' }, '오늘은 여기까지'),
      cancelBtn,
    );
  }
  function showCancelled() {
    box.replaceChildren(
      el('h1', { class: 'center' }, '기록을 취소했어요'),
      el('p', { class: 'note center' }, '방금 쓴 기록은 합계에 들어가지 않아요.'),
      el('a', { class: 'btn primary', href: '#/write' }, '다시 기록하기'),
      el('a', { class: 'btn', href: '#/home' }, '홈으로'),
    );
  }
  showDone();
  if (!saved.played) { saved.played = true; recordEffects(ctx.settings, box); } // EFFECTS-ENTRY: 화면을 다시 열어도 소리는 한 번만
  return box;
}

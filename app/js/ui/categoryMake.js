/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 내가 만드는 분류 (지출 분류만). 직접 쓰기 "어디에 쓰셨나요?"에서 만들고, 분류 보기·숨기기에서 이름을 고친다.
// 만들 때 묻는 것: 이름 -> 매달 나가는 돈인가 -> 꼭 써야 하는 돈인가 -> 확인. 대답은 결산의 고정비·변동비·일회성과
// 필수 지출 계산에 쓰인다(분류의 costTypeDefault, essentialDefault). 지우기는 없고 숨기기만 한다(D73).
import { el } from './dom.js';
import { dbGetAll, dbPut, newId } from '../storage/db.js';

export const MAX_USER_CATEGORIES = 20;   // 보이는(숨기지 않은) 내가 만든 분류의 최대 개수. 시험으로 조정한다.
export const NAME_MAX = 12;
const ORDER_START = 15;                  // 기본 분류 c01~c13은 1~13번, 기타(c14)는 50번이라 새 분류는 그 사이에 들어간다
const ORDER_LIMIT = 90;                  // 받은 돈 분류(101번~)와 겹치지 않게 한다

const COST_CHOICES = [
  ['fixed', '매달 나가는 돈'],
  ['variable', '그때그때 쓰는 돈'],
  ['oneoff', '한 번 크게 쓰는 돈'],
];
const COST_LABEL = Object.fromEntries(COST_CHOICES);

function fail(message) {
  const e = new Error(message);
  e.userMessage = message;
  return e;
}

export function cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
const keyOf = (s) => cleanName(s).replace(/\s/g, '').toLowerCase();

// 이름에 문제가 있으면 쉬운 말로 알려 준다. 문제가 없으면 빈 글자.
export function nameProblem(name, all, exceptId) {
  const n = cleanName(name);
  if (n.length === 0) return '분류 이름을 적어 주세요.';
  if ([...n].length > NAME_MAX) return '이름은 ' + NAME_MAX + '자까지 쓸 수 있어요.';
  const k = keyOf(n);
  const same = all.find((c) => c.kind === 'expense' && c.id !== exceptId && keyOf(c.name) === k);
  if (same) {
    return same.isActive === false
      ? '같은 이름의 분류가 이미 있어요. 숨겨 둔 분류예요. "분류 보기·숨기기"에서 다시 보이게 할 수 있어요.'
      : '같은 이름의 분류가 이미 있어요. 다른 이름을 적어 주세요.';
  }
  return '';
}

export function userActiveCount(all) {
  return all.filter((c) => c.isUserDefined && c.kind === 'expense' && c.isActive !== false).length;
}

export async function createUserCategory(db, { name, costType, essential }) {
  const all = await dbGetAll(db, 'categories');
  const problem = nameProblem(name, all, null);
  if (problem) throw fail(problem);
  if (!COST_LABEL[costType]) throw fail('매달 나가는 돈인지 골라 주세요.');
  if (typeof essential !== 'boolean') throw fail('꼭 써야 하는 돈인지 골라 주세요.');
  if (userActiveCount(all) >= MAX_USER_CATEGORIES) {
    throw fail('내가 만든 분류는 ' + MAX_USER_CATEGORIES + '개까지 만들 수 있어요. 쓰지 않는 분류는 숨기면 새로 만들 수 있어요.');
  }
  const orders = all.filter((c) => c.isUserDefined && c.kind === 'expense').map((c) => c.order || 0);
  const order = Math.max(ORDER_START - 1, ...orders) + 1;
  if (order >= ORDER_LIMIT) throw fail('더 만들 수 없어요. 쓰지 않는 분류를 숨겨 주세요.');
  const rec = {
    id: 'u-' + newId(), name: cleanName(name), kind: 'expense',
    costTypeDefault: costType, essentialDefault: essential,
    order, isActive: true, isUserDefined: true, createdAt: Date.now(),
  };
  await dbPut(db, 'categories', rec);
  return rec;
}

// 내가 만든 분류의 이름만 고친다. 이미 적은 기록은 분류 번호를 따라가므로 새 이름으로 보인다.
export async function renameUserCategory(db, id, name) {
  const all = await dbGetAll(db, 'categories');
  const cat = all.find((c) => c.id === id);
  if (!cat || !cat.isUserDefined) throw fail('이 분류는 이름을 고칠 수 없어요.');
  const problem = nameProblem(name, all, id);
  if (problem) throw fail(problem);
  const next = { ...cat, name: cleanName(name) };
  await dbPut(db, 'categories', next);
  return next;
}

// ---- 새 분류 만들기 화면 (직접 쓰기 2단계 안에서 열린다) ----
// onDone(새 분류): 만들었을 때, onCancel(): 그만둘 때
export function categoryMakePanel(ctx, { onDone, onCancel }) {
  const box = el('section', {});
  const form = { name: '', costType: null, essential: null };
  let step = 1;

  const stepLabel = () => el('p', { class: 'meta' }, step + ' / 4');
  const cancelBtn = () => el('button', { type: 'button', class: 'btn', onclick: () => onCancel() }, '그만둘게요');
  const prevBtn = () => el('button', { type: 'button', class: 'btn', onclick: () => { step -= 1; paint(); } }, '이전');
  const choice = (label, on, fn) => {
    const b = el('button', { type: 'button', class: 'btn seg' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false' }, (on ? '✓ ' : '') + label);
    b.addEventListener('click', fn);
    return b;
  };

  function pageName() {
    const input = el('input', { id: 'newcat-name', class: 'input', type: 'text', maxlength: String(NAME_MAX), autocomplete: 'off', value: form.name });
    const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
    const next = el('button', { type: 'button', class: 'btn primary' }, '다음');
    next.addEventListener('click', async () => {
      next.disabled = true; alertBox.hidden = true;
      try {
        const all = await dbGetAll(ctx.db, 'categories');
        const p = nameProblem(input.value, all, null);
        if (p) { alertBox.textContent = p; alertBox.hidden = false; next.disabled = false; return; }
        form.name = cleanName(input.value);
        step = 2; paint();
      } catch (e) {
        console.error(e);
        alertBox.textContent = '확인하지 못했어요. 한 번 더 눌러 주세요.'; alertBox.hidden = false; next.disabled = false;
      }
    });
    setTimeout(() => { try { input.focus(); } catch (e) { /* 무시 */ } }, 0);
    return [
      el('h1', {}, '새 분류 만들기'), stepLabel(),
      el('label', { for: 'newcat-name', class: 'label' }, '분류 이름 (' + NAME_MAX + '자까지)'),
      input,
      el('p', { class: 'note' }, '예: 텃밭, 반려동물, 커피, 손주 간식'),
      alertBox, next, cancelBtn(),
    ];
  }

  function pageCost() {
    return [
      el('h1', {}, '매달 나가는 돈인가요?'), stepLabel(),
      el('p', { class: 'meta' }, '분류: ' + form.name),
      el('p', { class: 'note' }, '매달 나가는 돈은 회비나 구독료처럼 정해진 돈, 그때그때 쓰는 돈은 장보기나 간식, 한 번 크게 쓰는 돈은 가전제품이나 큰 수리 같은 돈이에요.'),
      ...COST_CHOICES.map(([value, label]) => choice(label, form.costType === value, () => { form.costType = value; step = 3; paint(); })),
      prevBtn(), cancelBtn(),
    ];
  }

  function pageEssential() {
    return [
      el('h1', {}, '꼭 써야 하는 돈인가요?'), stepLabel(),
      el('p', { class: 'meta' }, '분류: ' + form.name),
      el('p', { class: 'note' }, '병원비나 공과금처럼 줄이기 어려운 돈이면 "꼭 써야 해요"를 고르세요. 이 돈은 결산에서 "늘었어요" 같은 신호를 내지 않아요.'),
      choice('꼭 써야 해요', form.essential === true, () => { form.essential = true; step = 4; paint(); }),
      choice('줄일 수 있어요', form.essential === false, () => { form.essential = false; step = 4; paint(); }),
      prevBtn(), cancelBtn(),
    ];
  }

  function pageConfirm() {
    const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
    const make = el('button', { type: 'button', class: 'btn primary' }, '이 분류 만들기');
    make.addEventListener('click', async () => {
      make.disabled = true; alertBox.hidden = true;
      try {
        const rec = await createUserCategory(ctx.db, form);
        onDone(rec);
      } catch (e) {
        console.error(e);
        alertBox.textContent = e.userMessage || '만들지 못했어요. 한 번 더 눌러 주세요.'; alertBox.hidden = false; make.disabled = false;
      }
    });
    return [
      el('h1', {}, '이 분류를 만들까요?'), stepLabel(),
      el('div', { class: 'card' },
        el('p', { class: 'kicker' }, '이름'), el('p', { class: 'row-value' }, form.name),
        el('p', { class: 'kicker' }, '성격'), el('p', { class: 'row-value' }, COST_LABEL[form.costType] + ' · ' + (form.essential ? '꼭 써야 해요' : '줄일 수 있어요'))),
      el('p', { class: 'note' }, '결산에서 이 성격으로 계산해요. 이름은 나중에 고칠 수 있고, 쓰지 않으면 숨길 수 있어요. 만들면 바로 이 분류로 기록해요.'),
      alertBox, make, prevBtn(), cancelBtn(),
    ];
  }

  function paint() {
    const pages = [null, pageName, pageCost, pageEssential, pageConfirm];
    box.replaceChildren(...pages[step]().filter(Boolean));
    if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
  }
  paint();
  return box;
}

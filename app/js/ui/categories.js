/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 분류 보기·숨기기 (S11 아래): 쓰지 않는 분류를 직접 쓰기 화면에서 감춘다.
// 지우지는 않는다. 이미 쓴 기록과 결산은 그대로이고, 언제든 다시 보이게 할 수 있다.
import { el } from './dom.js';
import { dbGetAll, dbGet, dbPut } from '../storage/db.js';
import { renameUserCategory, NAME_MAX } from './categoryMake.js'; // CATEGORY-MAKE-ENTRY

// 숨길 수 없는 분류: 어디에도 안 맞을 때 고르는 곳이 항상 있어야 한다
const KEEP = new Set(['c14', 'i03']);

export async function categoriesView(ctx) {
  const box = el('section', {});
  let failed = false;
  let editingId = null;       // 이름을 고치는 중인 분류 (CATEGORY-MAKE-ENTRY)

  // 다시 보이게 하는 것은 바로 한다. 숨기기는 확인 화면을 거친다(#/categories/hide/번호).
  async function show(cat) {
    try {
      await dbPut(ctx.db, 'categories', { ...cat, isActive: true });
      failed = false;
    } catch (e) { console.error(e); failed = true; }
    await paint();
  }

  // 내가 만든 분류의 이름 고치기: 이 자리에서 입력칸이 열린다
  function editRowOf(cat) {
    const input = el('input', { class: 'input', type: 'text', maxlength: String(NAME_MAX), autocomplete: 'off', 'aria-label': '분류 이름', value: cat.name });
    const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
    const save = el('button', { type: 'button', class: 'btn primary' }, '저장');
    save.addEventListener('click', async () => {
      save.disabled = true; alertBox.hidden = true;
      try {
        await renameUserCategory(ctx.db, cat.id, input.value);
        editingId = null;
        await paint();
      } catch (e) {
        console.error(e);
        alertBox.textContent = e.userMessage || '바꾸지 못했어요. 한 번 더 눌러 주세요.'; alertBox.hidden = false; save.disabled = false;
      }
    });
    const cancel = el('button', { type: 'button', class: 'btn', onclick: () => { editingId = null; paint(); } }, '그만둘게요');
    setTimeout(() => { try { input.focus(); } catch (e) { /* 무시 */ } }, 0);
    return el('div', { class: 'cat-row' },
      el('p', { class: 'meta' }, '이름을 고치면 이미 적은 기록에도 새 이름으로 보여요.'),
      input, alertBox, save, cancel);
  }

  function rowOf(cat) {
    if (editingId === cat.id) return editRowOf(cat);
    const locked = KEEP.has(cat.id);
    const shown = cat.isActive !== false;
    const mine = !!cat.isUserDefined;
    const state = locked ? '✓ 항상 보여요 (숨길 수 없어요)' : (shown ? '✓ 보여요' : '− 숨겼어요');
    return el('div', { class: 'row cat-row' },
      el('div', { class: 'cat-name' },
        el('p', { class: 'item-title' }, cat.name),
        el('p', { class: 'meta' }, state + (mine ? ' · 내가 만든 분류' : ''))),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;' },
        mine ? el('button', {
          type: 'button', class: 'btn', 'aria-label': cat.name + ' 이름 고치기',
          onclick: () => { editingId = cat.id; paint(); },
        }, '이름 고치기') : null,
        locked ? null : el('button', {
          type: 'button', class: 'btn' + (shown ? '' : ' primary'),
          'aria-label': cat.name + (shown ? ' 숨기기' : ' 다시 보이기'),
          onclick: () => { if (shown) location.hash = '#/categories/hide/' + encodeURIComponent(cat.id); else show(cat); },
        }, shown ? '숨기기' : '다시 보이기')));
  }

  async function paint() {
    const all = (await dbGetAll(ctx.db, 'categories')).sort((a, b) => a.order - b.order);
    const out = all.filter((c) => c.kind === 'expense');
    const inc = all.filter((c) => c.kind === 'income');
    box.replaceChildren(...[
      el('h1', {}, '분류 보기·숨기기'),
      failed ? el('div', { class: 'alert', role: 'alert' }, '바꾸지 못했어요. 한 번 더 눌러 주세요.') : null,
      el('p', { class: 'note' }, '쓰지 않는 분류를 숨기면 직접 쓰기 화면이 더 간단해져요. 이미 적은 기록과 결산은 그대로예요. 언제든 다시 보이게 할 수 있어요.'),
      el('div', { class: 'card' },
        el('p', { class: 'kicker' }, '쓴 돈 분류'),
        out.map(rowOf)),
      el('div', { class: 'card' },
        el('p', { class: 'kicker' }, '받은 돈 분류'),
        inc.map(rowOf)),
      el('a', { class: 'btn' + (ctx.catBack ? ' primary' : ''), href: ctx.catBack || '#/more', onclick: () => { ctx.catBack = null; } },
        ctx.catBack ? '쓰던 화면으로 돌아가기' : '더보기로'),
    ].filter(Boolean));
  }

  await paint();
  return box;
}

// 숨기기 확인 화면: 안전한 쪽(그만둘게요)을 위에 둔다
export async function categoryHideView(ctx, path, params) {
  const cat = await dbGet(ctx.db, 'categories', params.id);
  if (!cat || cat.isActive === false || KEEP.has(cat.id)) { location.replace('#/categories'); return el('section'); }
  const stay = el('a', { class: 'btn primary', href: '#/categories' }, '그만둘게요');
  const failBox = el('div', { class: 'alert', role: 'alert', hidden: true }, '숨기지 못했어요. 한 번 더 눌러 주세요.');
  const go = el('button', { type: 'button', class: 'btn danger' }, '숨길게요');
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      await dbPut(ctx.db, 'categories', { ...cat, isActive: false });
      location.hash = '#/categories';
    } catch (e) { console.error(e); failBox.hidden = false; go.disabled = false; }
  });
  return el('section', {},
    el('h1', {}, '정말 숨길까요?'),
    el('div', { class: 'card' },
      el('p', { class: 'row-value' }, cat.name),
      el('p', { class: 'meta' }, cat.kind === 'income' ? '받은 돈 분류' : '쓴 돈 분류')),
    el('p', { class: 'note warn' }, '숨기면 직접 쓰기 화면에서 이 분류가 안 보여요. 이미 적은 기록은 그대로예요. 언제든 다시 보이게 할 수 있어요.'),
    stay, failBox, go);
}

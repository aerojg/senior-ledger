/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// S9 저금통 (화면흐름 v1.3): 칸 목록(최대 3칸), 칸 상세, 칸 만들기·고치기, [옮겼어요] 체크
// 저금통은 가상이다. 앱이 돈을 보관하지 않고, 실제로 옮긴 것을 체크해 두는 곳이다 (R06).
// 주소 추가: #/jar/used/번호 ([썼어요]) #/jar/delete/번호 ([이 칸 지우기])
// 4단계 구간 1: 칸을 3개까지 만들 수 있다. 구간 3: 약속에서 아낀 돈(계산)을 칸에 담아 보인다. 목표 달성은 구간 3의 뒷 단계.
// 주소: #/jar(목록) #/jar/new #/jar/open/번호 #/jar/edit/번호 #/jar/move/번호 #/jar/entry/기록번호
import { el } from './dom.js';
import { formatWon, formatDateKo } from './format.js';
import { makeAmountField } from './amountField.js';
import { todayStr } from '../storage/dates.js';
import {
  MAX_JARS, JAR_SUGGESTIONS, listJars, getJar, createJar, updateJar, deleteJar, restoreJar,
  addMoved, listEntries, softDeleteEntry, restoreEntry, sumEntries, fillPercent,
} from '../storage/jars.js';
import { listUnassigned } from '../storage/pledges.js';
import { isAchieved, useJar, undoUse } from '../storage/jarUse.js';
import { dbGetAll } from '../storage/db.js';

// 채움 막대와 글자 (색만으로 구분하지 않고 퍼센트 글자를 함께 보인다, U5)
export function jarProgress(jar, sums) {
  const pct = fillPercent(sums.balance, jar.targetAmount);
  return el('div', { class: 'bar-row jar-progress' },
    el('div', { class: 'row' },
      el('p', { class: 'bar-name' }, jar.name),
      el('p', { class: 'row-value' }, pct + '%')),
    el('div', { class: 'bar-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': jar.name + ' ' + pct + '퍼센트' },
      el('div', { class: 'bar-fill', style: 'width:' + pct + '%' })));
}

// 칸 카드와 상세에서 쓰는 두 줄 막대: 실제로 옮긴 돈, 계산된 아낀 돈. 줄마다 이름을 글로 적는다 (U5).
function dualBars(jar, sums) {
  const movedPct = fillPercent(sums.balance, jar.targetAmount);
  const savedPct = fillPercent(sums.saved, jar.targetAmount);
  const bar = (label, pct, extra) => el('div', { class: 'bar-row' },
    el('div', { class: 'row' }, el('p', { class: 'bar-name' }, label), el('p', { class: 'row-value' }, pct + '%')),
    el('div', { class: 'bar-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': jar.name + ' ' + label + ' ' + pct + '퍼센트' },
      el('div', { class: 'bar-fill', style: 'width:' + pct + '%' + (extra || '') })));
  return [bar('옮긴 돈', movedPct), bar('아낀 돈(계산)', savedPct, ';opacity:.55')];
}

// 아직 칸을 정하지 않은 아낀 돈 (있을 때만)
async function pendingCard(ctx) {
  const list = await listUnassigned(ctx.db);
  if (list.length === 0) return null;
  const total = list.reduce((a, r) => a + r.savedAmount, 0);
  return el('a', { class: 'card card-link', href: '#/pledge' },
    el('p', { class: 'kicker' }, '아직 정하지 않은 돈'),
    el('p', { class: 'big-number' }, formatWon(total)),
    el('p', { class: 'meta' }, '약속에서 아낀 돈이에요. 눌러서 어느 칸에 담을지 정해요.'));
}

const NOT_REAL_MONEY = '이 앱은 실제 돈을 보관하지 않아요. 통장에서 돈을 따로 옮기신 뒤에 [옮겼어요]로 적어 두는 곳이에요.';

// ---- 저금통 화면: 칸 카드 목록 ----
export async function jarView(ctx) {
  const undo = ctx.jarListUndo || null;     // 방금 칸을 지웠을 때만: { id, text }
  ctx.jarListUndo = null;                   // 한 번 보여 준 뒤에는 지운다
  const box = el('section', {});
  let undone = false;
  let undoError = '';

  async function paint() {
    const jars = await listJars(ctx.db);
    const banner = (undo && !undone) ? el('div', { class: 'banner', role: 'status' },
      el('span', {}, undo.text),
      el('button', {
        type: 'button', class: 'link-btn',
        onclick: async () => {
          try { await restoreJar(ctx.db, undo.id); undone = true; undoError = ''; }
          catch (e) { undoError = e.userMessage || '되돌리지 못했어요. 한 번 더 눌러 주세요.'; }
          await paint();
        },
      }, '되돌리기')) : null;
    const errBox = undoError ? el('div', { class: 'alert', role: 'alert' }, undoError) : null;

    if (jars.length === 0) {
      box.replaceChildren(...[
        el('h1', {}, '저금통'),
        banner, errBox,
        el('div', { class: 'card' },
          el('p', {}, '아직 저금통 칸이 없어요.'),
          el('p', { class: 'note' }, '칸은 돈을 모으는 목적 하나예요. 예를 들면 "손주 선물"처럼 이름을 붙이고 목표 금액을 정해요.'),
          el('p', { class: 'note warn' }, NOT_REAL_MONEY)),
        await pendingCard(ctx),
        el('a', { class: 'btn primary', href: '#/jar/new' }, '칸 만들기'),
      ].filter(Boolean));
      return;
    }

    const cards = [];
    for (const jar of jars) {
      const sums = sumEntries(await listEntries(ctx.db, jar.id));
      cards.push(el('a', { class: 'card card-link', href: '#/jar/open/' + jar.id },
        el('p', { class: 'bar-name' }, jar.name),
        dualBars(jar, sums),
        el('p', { class: 'meta line-tight' }, '옮긴 돈 ' + formatWon(sums.balance) + ' / 아낀 돈(계산) ' + formatWon(sums.saved)),
        el('p', { class: 'meta line-tight' }, '목표 ' + formatWon(jar.targetAmount)),
        isAchieved(jar, sums) ? el('p', { class: 'sig-line' }, el('span', { class: 'sig-shape', 'aria-hidden': 'true' }, '●'), ' 목표를 채웠어요') : null));
    }

    box.replaceChildren(...[
      el('h1', {}, '저금통'),
      banner, errBox,
      el('p', { class: 'note' }, '칸을 누르면 기록을 보고 [옮겼어요]를 적을 수 있어요.'),
      await pendingCard(ctx),
      cards,
      jars.length < MAX_JARS
        ? el('a', { class: 'btn primary', href: '#/jar/new' }, '칸 만들기')
        : el('p', { class: 'note' }, '칸은 ' + MAX_JARS + '개까지 만들 수 있어요.'),
      el('p', { class: 'note warn' }, NOT_REAL_MONEY),
    ].flat().filter(Boolean));
  }

  await paint();
  return box;
}

// ---- 칸 상세 ----
export async function jarDetailView(ctx, path, params) {
  const jar = await getJar(ctx.db, params.id);
  if (!jar || jar.deletedAt) {
    return el('section', {},
      el('h1', {}, '저금통 칸을 찾지 못했어요'),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'));
  }
  const box = el('section', {});
  const undo = ctx.jarUndo || null;     // { id, text, action: 'cancel' | 'restore', label }
  ctx.jarUndo = null;                   // 한 번 보여 준 뒤에는 지운다
  let undone = false;

  async function paint() {
    const entries = await listEntries(ctx.db, jar.id);
    const sums = sumEntries(entries);
    const remain = jar.targetAmount - sums.balance;

    const banner = (undo && !undone) ? el('div', { class: 'banner', role: 'status' },
      el('span', {}, undo.text),
      el('button', {
        type: 'button', class: 'link-btn',
        onclick: async () => {
          if (undo.action === 'cancel') await softDeleteEntry(ctx.db, undo.id);
          else await restoreEntry(ctx.db, undo.id);
          undone = true;
          await paint();
        },
      }, undo.label)) : null;

    box.replaceChildren(...[
      el('h1', {}, '저금통'),
      banner,
      el('div', { class: 'card' },
        el('p', { class: 'bar-name' }, jar.name),
        dualBars(jar, sums),
        el('hr', { class: 'rule' }),
        el('p', { class: 'kicker tight' }, '옮긴 돈'),
        el('p', { class: 'big-number tight' }, formatWon(sums.balance)),
        el('p', { class: 'meta line-tight' }, '아낀 돈(계산) ' + formatWon(sums.saved)),
        // 금액이 길어도 한 줄에서 잘리지 않게 목표와 남은 금액을 줄 바꿔 보인다
        el('p', { class: 'meta line-tight' }, '목표 ' + formatWon(jar.targetAmount)),
        el('p', { class: 'meta line-tight' }, remain > 0 ? '앞으로 ' + formatWon(remain) : '목표를 채웠어요')),
      isAchieved(jar, sums) ? el('div', { class: 'card' },
        el('p', { class: 'sig-line' }, el('span', { class: 'sig-shape', 'aria-hidden': 'true' }, '●'), ' 목표를 채웠어요'),
        el('p', {}, '축하드려요. 모으신 ' + formatWon(sums.balance) + '을 쓰셨다면 [썼어요]를 눌러 주세요.'),
        el('a', { class: 'btn primary', href: '#/jar/used/' + jar.id }, '썼어요')) : null,
      el('a', { class: 'btn' + (isAchieved(jar, sums) ? '' : ' primary'), href: '#/jar/move/' + jar.id }, '옮겼어요'),
      el('h2', {}, '기록'),
      entries.length === 0
        ? el('div', { class: 'card' }, el('p', { class: 'meta' }, '아직 기록이 없어요. 통장에서 돈을 옮기셨다면 [옮겼어요]를 눌러 주세요.'))
        : entries.map((e) => {
            const label = e.kind === 'saved' ? '[아낀 돈] ' : e.kind === 'used' ? '[쓴 돈] ' : '[옮긴 돈] ';
            const body = [
              el('div', { class: 'item-main' },
                el('p', { class: 'item-title' }, label + formatDateKo(e.date)),
                e.memo ? el('p', { class: 'meta' }, e.memo) : null),
              el('p', { class: 'item-amount' }, formatWon(e.amount)),
            ];
            // 계산된 아낀 돈과 쓴 돈은 지우는 화면으로 연결하지 않는다 (옮긴 기록만 지울 수 있다)
            return e.kind !== 'moved' ? el('div', { class: 'item' }, ...body) : el('a', { class: 'item', href: '#/jar/entry/' + e.id }, ...body);
          }),
      el('hr', { class: 'sep' }),
      el('a', { class: 'btn', href: '#/jar/edit/' + jar.id }, '이름·목표 고치기'),
      el('a', { class: 'btn', href: '#/jar/delete/' + jar.id }, '이 칸 지우기'),
      el('a', { class: 'btn', href: '#/jar' }, '저금통으로'),
    ].flat().filter(Boolean));
  }

  await paint();
  return box;
}

// ---- 칸 만들기·고치기 ----
export async function jarFormView(ctx, path, params) {
  const editing = path.indexOf('/jar/edit') === 0;
  const jars = await listJars(ctx.db);
  const jar = editing ? await getJar(ctx.db, params && params.id) : null;
  if (editing && (!jar || jar.deletedAt)) {
    return el('section', {},
      el('h1', {}, '저금통 칸을 찾지 못했어요'),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'));
  }
  if (!editing && jars.length >= MAX_JARS) {
    return el('section', {},
      el('h1', {}, '칸을 모두 만들었어요'),
      el('div', { class: 'card' }, el('p', {}, '저금통 칸은 ' + MAX_JARS + '개까지 만들 수 있어요.')),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'));
  }
  const backHref = editing ? '#/jar/open/' + jar.id : '#/jar';

  const name = el('input', { id: 'jar-name', class: 'input', type: 'text', maxlength: '20', autocomplete: 'off', value: jar ? jar.name : '' });
  const target = makeAmountField({ id: 'jar-target', initial: jar ? jar.targetAmount : 0 });
  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });

  // 이미 만든 칸의 이름은 제안에서 뺀다
  const used = new Set(jars.map((j) => j.name));
  const choices = JAR_SUGGESTIONS.filter((s) => !used.has(s));
  const suggestions = (editing || choices.length === 0) ? null : el('div', {},
    el('p', { class: 'label' }, '이름을 골라 보세요'),
    el('div', { class: 'grid2' }, choices.map((s) =>
      el('button', { type: 'button', class: 'btn cat', onclick: () => { name.value = s; name.focus(); } }, s))));

  const save = el('button', { type: 'button', class: 'btn primary' }, editing ? '저장' : '칸 만들기');
  save.addEventListener('click', async () => {
    save.disabled = true; alertBox.hidden = true;
    try {
      const input = { name: name.value, targetAmount: target.amount };
      if (editing) {
        await updateJar(ctx.db, jar.id, input);
        location.hash = '#/jar/open/' + jar.id;
      } else {
        await createJar(ctx.db, input);
        location.hash = '#/jar';
      }
    } catch (e) {
      alertBox.textContent = e.userMessage || '저장하지 못했어요. 한 번 더 눌러 주세요.';
      alertBox.hidden = false;
      save.disabled = false;
    }
  });

  return el('section', {},
    el('h1', {}, editing ? '이름·목표 고치기' : '저금통 칸 만들기'),
    suggestions,
    el('label', { for: 'jar-name', class: 'label' }, '칸 이름 (직접 쓰셔도 돼요)'), name,
    el('label', { for: 'jar-target', class: 'label' }, '목표 금액 (원)'),
    target.input, target.reading,
    alertBox,
    save,
    el('a', { class: 'btn', href: backHref }, '뒤로'),
  );
}

// ---- [옮겼어요] ----
export async function jarMoveView(ctx, path, params) {
  const jar = await getJar(ctx.db, params && params.id);
  if (!jar || jar.deletedAt) {
    return el('section', {},
      el('h1', {}, '저금통 칸을 찾지 못했어요'),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'));
  }

  const amount = makeAmountField({ id: 'move-amount' });
  const dateInput = el('input', { id: 'move-date', class: 'input', type: 'date', value: todayStr() });
  const memo = el('input', { id: 'move-memo', class: 'input', type: 'text', maxlength: '60', autocomplete: 'off' });
  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });

  const save = el('button', { type: 'button', class: 'btn primary' }, '옮겼다고 적기');
  save.addEventListener('click', async () => {
    save.disabled = true; alertBox.hidden = true;
    try {
      const entry = await addMoved(ctx.db, { jarId: jar.id, amount: amount.amount, date: dateInput.value, memo: memo.value });
      // 방금 적은 기록을 곧바로 취소할 수 있게 줄을 보인다 (U8)
      ctx.jarUndo = { id: entry.id, action: 'cancel', label: '방금 기록 취소', text: formatWon(entry.amount) + ' 옮겼다고 적었어요.' };
      location.hash = '#/jar/open/' + jar.id;
    } catch (e) {
      alertBox.textContent = e.userMessage || '저장하지 못했어요. 한 번 더 눌러 주세요.';
      alertBox.hidden = false;
      save.disabled = false;
    }
  });

  return el('section', {},
    el('h1', {}, '얼마를 옮기셨나요?'),
    el('p', { class: 'note' }, jar.name + ' 칸에 적어 둘게요. 실제로 통장에서 옮기신 뒤에 적어 주세요.'),
    el('label', { for: 'move-amount', class: 'label' }, '금액 (원)'),
    amount.input, amount.reading,
    el('label', { for: 'move-date', class: 'label' }, '옮긴 날'), dateInput,
    el('label', { for: 'move-memo', class: 'label' }, '메모 (없어도 돼요)'), memo,
    alertBox,
    save,
    el('a', { class: 'btn', href: '#/jar/open/' + jar.id }, '뒤로'),
  );
}

// ---- 옮긴 기록 지우기 (두 번 확인, D60) ----
export async function jarEntryView(ctx, path, params) {
  // 기록 번호만으로 어느 칸의 기록인지 찾는다
  let entry = null;
  let jar = null;
  for (const j of await listJars(ctx.db)) {
    const found = (await listEntries(ctx.db, j.id)).find((e) => e.id === params.id);
    if (found) { entry = found; jar = j; break; }
  }
  if (!entry) {
    return el('section', {},
      el('h1', {}, '기록을 찾지 못했어요'),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'));
  }
  const backHref = '#/jar/open/' + jar.id;
  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const really = el('button', { type: 'button', class: 'btn danger' }, '지울게요');
  really.addEventListener('click', async () => {
    really.disabled = true;
    try {
      await softDeleteEntry(ctx.db, entry.id);
      ctx.jarUndo = { id: entry.id, action: 'restore', label: '되돌리기', text: formatDateKo(entry.date) + ' ' + formatWon(entry.amount) + ' 기록을 지웠어요.' };
      location.hash = backHref;
    } catch (e) {
      alertBox.textContent = '지우지 못했어요. 한 번 더 눌러 주세요.';
      alertBox.hidden = false;
      really.disabled = false;
    }
  });
  return el('section', {},
    el('h1', {}, '이 기록을 지울까요?'),
    el('div', { class: 'card' },
      el('p', { class: 'meta' }, jar.name),
      el('p', { class: 'row-value' }, formatWon(entry.amount)),
      el('p', { class: 'meta' }, formatDateKo(entry.date) + (entry.memo ? ' · ' + entry.memo : ''))),
    alertBox,
    el('a', { class: 'btn primary', href: backHref }, '그만둘게요'),
    really,
    el('p', { class: 'note' }, '지워도 바로 되돌릴 수 있어요.'),
  );
}

// ---- [썼어요]: 어디에 쓰셨나요 -> 맞나요 -> 기록 (응원 소비) ----
export async function jarUsedView(ctx, path, params) {
  const jar = await getJar(ctx.db, params && params.id);
  if (!jar || jar.deletedAt || jar.status === 'done') {
    return el('section', {},
      el('h1', {}, jar && !jar.deletedAt ? '이미 마무리한 칸이에요' : '저금통 칸을 찾지 못했어요'),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'));
  }
  const balance = sumEntries(await listEntries(ctx.db, jar.id)).balance;
  if (balance < 1) {
    return el('section', {},
      el('h1', {}, '쓸 수 있는 돈이 없어요'),
      el('p', { class: 'note' }, '이 칸에 옮겨 둔 돈이 없어요. 먼저 [옮겼어요]로 적어 주세요.'),
      el('a', { class: 'btn primary', href: '#/jar/open/' + jar.id }, '칸으로'));
  }

  // 쓴 돈 분류만, 숨기지 않은 것만 순서대로 (직접 쓰기와 같은 방식: 6개 + 더보기)
  const cats = (await dbGetAll(ctx.db, 'categories'))
    .filter((c) => c.kind === 'expense' && c.isActive !== false)
    .sort((a, b) => a.order - b.order);
  const box = el('section', {});
  let chosen = null;
  let showMore = false;
  const amount = makeAmountField({ id: 'use-amount' });
  const dateInput = el('input', { id: 'use-date', class: 'input', type: 'date', value: todayStr() });
  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const grid = el('div', { class: 'grid2' });
  const moreBtn = el('button', { type: 'button', class: 'btn sub' });

  function paintGrid() {
    const list = showMore ? cats : cats.slice(0, 6);
    grid.replaceChildren(...list.map((c) =>
      el('button', { type: 'button', class: 'btn cat' + (chosen && chosen.id === c.id ? ' on' : ''), onclick: () => { chosen = c; paintGrid(); } },
        (chosen && chosen.id === c.id ? '✓ ' : '') + c.name)));
    moreBtn.textContent = showMore ? '▲ 접기' : '▼ 분류 더보기';
    moreBtn.hidden = cats.length <= 6;
  }
  moreBtn.addEventListener('click', () => { showMore = !showMore; paintGrid(); });

  const allBtn = el('button', { type: 'button', class: 'btn sub' }, '모은 돈 전부 (' + formatWon(balance) + ')');
  allBtn.addEventListener('click', () => {
    amount.input.value = String(balance);
    amount.input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  function showForm() {
    paintGrid();
    box.replaceChildren(
      el('h1', {}, '어디에 쓰셨나요?'),
      el('p', { class: 'note' }, jar.name + ' 칸에 모은 돈은 ' + formatWon(balance) + '이에요.'),
      grid, moreBtn,
      el('label', { for: 'use-amount', class: 'label' }, '쓴 금액 (원)'),
      amount.input, amount.reading, allBtn,
      el('label', { for: 'use-date', class: 'label' }, '쓴 날'), dateInput,
      alertBox,
      el('button', { type: 'button', class: 'btn primary', onclick: goConfirm }, '다음'),
      el('a', { class: 'btn', href: '#/jar/open/' + jar.id }, '뒤로'));
  }

  function goConfirm() {
    alertBox.hidden = true;
    const a = amount.amount;
    let msg = '';
    if (!chosen) msg = '어디에 쓰셨는지 골라 주세요.';
    else if (!Number.isInteger(a) || a < 1) msg = '쓴 금액을 1원 이상으로 입력해 주세요.';
    else if (a > balance) msg = '칸에 모은 돈(' + formatWon(balance) + ')보다 많아요. 금액을 다시 확인해 주세요.';
    else if (!dateInput.value) msg = '날짜를 다시 확인해 주세요.';
    if (msg) { alertBox.textContent = msg; alertBox.hidden = false; return; }

    const save = el('button', { type: 'button', class: 'btn primary' }, '맞아요, 기록하기');
    const err = el('div', { class: 'alert', role: 'alert', hidden: true });
    save.addEventListener('click', async () => {
      save.disabled = true; err.hidden = true;
      try {
        const res = await useJar(ctx.db, { jarId: jar.id, categoryId: chosen.id, amount: a, date: dateInput.value });
        showDone(res);
      } catch (e) {
        err.textContent = e.userMessage || '저장하지 못했어요. 한 번 더 눌러 주세요.';
        err.hidden = false;
        save.disabled = false;
      }
    });
    box.replaceChildren(
      el('h1', {}, '맞나요?'),
      el('div', { class: 'card' },
        el('p', { class: 'meta' }, jar.name + ' 칸'),
        el('p', { class: 'big-number' }, formatWon(a)),
        el('p', {}, chosen.name + ' · ' + formatDateKo(dateInput.value))),
      el('p', { class: 'note' }, '저금통 목적에 쓴 돈(응원 소비)으로 기록돼요. 절약 경고와 평소 기준에서는 빠져요.'),
      err, save,
      el('button', { type: 'button', class: 'btn', onclick: showForm }, '고칠게요'));
  }

  function showDone(res) {
    const undoBtn = el('button', { type: 'button', class: 'btn' }, '방금 기록 취소');
    undoBtn.addEventListener('click', async () => {
      undoBtn.disabled = true;
      try {
        await undoUse(ctx.db, res);
        box.replaceChildren(
          el('h1', {}, '취소했어요'),
          el('p', { class: 'note' }, '방금 기록을 없앴어요. 칸은 그대로예요.'),
          el('a', { class: 'btn primary', href: '#/jar/open/' + jar.id }, '칸으로'));
      } catch (e) {
        undoBtn.disabled = false;
        undoBtn.textContent = '취소하지 못했어요. 한 번 더 눌러 주세요';
      }
    });
    box.replaceChildren(
      el('h1', {}, '기록했어요'),
      el('div', { class: 'card' },
        el('p', {}, formatWon(res.entry.amount) + '을 쓰신 것으로 적었어요.'),
        res.jarDone ? el('p', { class: 'note' }, '모은 돈을 모두 쓰셨어요. 이 칸은 마무리했고, 새 칸을 만들 수 있어요.') : null),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'),
      undoBtn);
  }

  showForm();
  return box;
}

// ---- 칸 지우기 (확인 한 번, D60·D92) ----
export async function jarDeleteView(ctx, path, params) {
  const jar = await getJar(ctx.db, params && params.id);
  if (!jar || jar.deletedAt) {
    return el('section', {},
      el('h1', {}, '저금통 칸을 찾지 못했어요'),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'));
  }
  const entries = await listEntries(ctx.db, jar.id);
  const sums = sumEntries(entries);
  const backHref = '#/jar/open/' + jar.id;
  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const really = el('button', { type: 'button', class: 'btn danger' }, '지울게요');
  really.addEventListener('click', async () => {
    really.disabled = true; alertBox.hidden = true;
    try {
      await deleteJar(ctx.db, jar.id);
      // 지운 직후 저금통 목록에서 되돌릴 수 있게 한다 (U8)
      ctx.jarListUndo = { id: jar.id, text: jar.name + ' 칸을 지웠어요.' };
      location.hash = '#/jar';
    } catch (e) {
      alertBox.textContent = e.userMessage || '지우지 못했어요. 한 번 더 눌러 주세요.';
      alertBox.hidden = false;
      really.disabled = false;
    }
  });
  return el('section', {},
    el('h1', {}, '이 칸을 지울까요?'),
    el('div', { class: 'card' },
      el('p', { class: 'row-value' }, jar.name),
      el('p', { class: 'meta' }, '목표 ' + formatWon(jar.targetAmount) + ' · 옮긴 돈 ' + formatWon(sums.balance))),
    entries.length > 0
      ? el('p', { class: 'note warn' }, '이 칸의 기록 ' + entries.length + '건(옮긴 돈 ' + formatWon(sums.moved) + ' 포함)도 함께 보이지 않게 돼요.')
      : null,
    el('p', { class: 'note' }, '지운 직후에는 저금통 화면에서 [되돌리기]를 누를 수 있어요.'),
    alertBox,
    el('a', { class: 'btn primary', href: backHref }, '그만둘게요'),
    really,
  );
}

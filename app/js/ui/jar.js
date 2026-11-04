/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// S9 저금통 (화면흐름 v1.7): 한 화면에 칸 하나씩, 칸 상세(기록), 칸 만들기·고치기, [저금했어요] 체크
// 저금통은 가상이다. 앱이 돈을 보관하지 않고, 실제로 저금한 것을 체크해 두는 곳이다 (R06).
// D113: 저금통에는 두 가지 돈이 있다. ① 미리 떼어 둔 돈(지출유보 적립금): 1년 안에 쓸 큰돈을 생활비에서 미리 떼어 두는 칸, 내가 만든다(최대 3칸).
//       ② 남은 돈 모음: 월 결산 뒤 남은 돈을 적어 두는 칸, 앱이 하나 자동으로 만든다(칸 수에 세지 않는다).
// 막대: 미리 떼어 둔 돈 칸은 4개(저금 총액·이달 저금액·중간 사용액·저금 목표액), 남은 돈 모음은 목표가 없어 3개.
// '약속으로 아낀 돈'은 저금통에서 뺐다(결산·약속 쪽에만 남는다). 화면 안의 칸 위치는 ctx.jarPos(칸 번호)에 두고 주소는 늘리지 않았다.
// 주소: #/jar(목록) #/jar/new #/jar/open/번호 #/jar/edit/번호 #/jar/move/번호 #/jar/entry/기록번호 #/jar/used/번호 #/jar/delete/번호
import { el } from './dom.js';
import { foldBox, foldButton, foldRow } from './fold.js';
import { formatWon, formatDateKo } from './format.js';
import { makeAmountField } from './amountField.js';
import { todayStr, periodKeyOf, periodRange } from '../storage/dates.js';
import {
  MAX_JARS, JAR_SUGGESTIONS, PURPOSE_MAX, PURPOSE_EXAMPLES, PURPOSE_DEFAULT_EXAMPLE, listJars, listReserveJars, ensureSurplusJar, isSurplus,
  getJar, createJar, updateJar, deleteJar, restoreJar,
  addMoved, findSameMoved, listEntries, softDeleteEntry, restoreEntry, sumEntries, sumMovedIn, fillPercent,
} from '../storage/jars.js';
import { getJarHint, dismissJarHint } from '../storage/jarHint.js';
import { jarHelpCard } from './jarHelp.js';
import { isAchieved, useJar, useJarSplit, undoUse, deleteEntryWithTx, restoreEntryWithTx } from '../storage/jarUse.js';
import { dbGetAll } from '../storage/db.js';

// 채움 막대와 글자 (색만으로 구분하지 않고 퍼센트 글자를 함께 보인다, U5)
export function jarProgress(jar, sums) {
  const pct = fillPercent(sums.balance, jar.targetAmount);
  return el('div', { class: 'bar-row jar-progress' },
    el('div', { class: 'row pct-row' },
      el('p', { class: 'bar-name jar-name' }, jar.name),
      el('p', { class: 'row-value' }, pct + '%')),
    el('div', { class: 'bar-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': jar.name + ' ' + pct + '퍼센트' },
      el('div', { class: 'bar-fill', style: 'width:' + pct + '%' })));
}

// 막대: 모두 실제로 저금한 돈 이야기다 (R06). 미리 떼어 둔 돈 칸은 목표 금액을, 남은 돈 모음은 저금 총액을 100%로 놓고 그린다.
// 줄마다 이름과 금액을 글로 적는다 (U5). 중간 사용액은 색만이 아니라 사선 무늬(.bar-calc)로도 구분한다 (Q59).
function bars(jar, nums) {
  const base = isSurplus(jar) ? nums.total : jar.targetAmount;
  const bar = (label, value, extra) => {
    const pct = fillPercent(value, base);
    return el('div', { class: 'bar-row' },
      el('div', { class: 'row pct-row' }, el('p', { class: 'bar-name' }, label), el('p', { class: 'row-value' }, formatWon(value))),
      el('div', { class: 'bar-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': jar.name + ' ' + label + ' ' + formatWon(value) },
        el('div', { class: 'bar-fill' + (extra || ''), style: 'width:' + pct + '%' })));
  };
  const out = [bar('저금 총액', nums.total), bar('이달 저금액', nums.month), bar('중간 사용액', nums.used, ' bar-calc')];
  if (!isSurplus(jar)) out.push(bar('저금 목표액', jar.targetAmount));
  return out;
}

// 막대에 쓸 숫자: 저금 총액(지금까지 저금한 돈), 이달 저금액(결산의 한 달 기준), 중간 사용액(쓴 돈)
function numbersOf(ctx, entries, sums) {
  const startDay = (ctx.settings && ctx.settings.monthStartDay) || 1;
  const range = periodRange(periodKeyOf(todayStr(), startDay), startDay);
  return { total: sums.moved, month: sumMovedIn(entries, range.start, range.end), used: sums.used };
}

// 칸 하나의 요약: 종류, 이름, 용도, 지금 남은 돈, 막대, 목표까지
function summaryCard(jar, sums, nums) {
  const surplus = isSurplus(jar);
  const owed = sums.balance < 0;               // 먼저 쓴 돈: 모은 돈보다 많이 쓴 상태 (D114)
  const remain = (surplus || owed) ? 0 : jar.targetAmount - sums.balance;
  return el('div', { class: 'card' },
    el('p', { class: 'kicker' }, surplus ? '남은 돈 모음' : '미리 떼어 둔 돈'),
    surplus ? null : el('p', { class: 'bar-name jar-title' }, jar.name),
    jar.purpose
      ? el('p', { class: 'meta line-tight' }, jar.purpose)
      : el('p', { class: 'note' }, '용도를 적어 두면 쓸 때 도움이 돼요.'),
    el('p', { class: 'kicker tight' }, owed ? '먼저 쓴 돈 (앞으로 채울 돈)' : '지금 남은 돈'),
    el('p', { class: 'big-number tight' }, formatWon(owed ? -sums.balance : sums.balance)),
    owed ? el('p', { class: 'sig-line' }, el('span', { class: 'sig-shape', 'aria-hidden': 'true' }, '▲'), ' 올해 안에 저금해서 채워 주세요') : null,
    bars(jar, nums),
    remain > 0 ? el('p', { class: 'meta line-tight' }, '목표까지 ' + formatWon(remain)) : null,
    el('p', { class: 'note' }, surplus
      ? '결산을 하고 남은 돈을 통장에 따로 저금하셨다면 여기에 적어 두세요.'
      : '1년 안에 쓸 큰돈을 위해, 생활비에서 미리 떼어 두는 칸이에요. 저금하면 [홈]의 쓴 돈에도 함께 적혀요.'));
}

// 남은 돈 안내 상자 (D113). 남은 돈 모음 화면에만 보인다. 저금 기록은 이 상자와 상관없이 언제든 할 수 있다.
function hintCard(h, onDismiss) {
  return el('div', { class: 'card', role: 'status' },
    el('p', { class: 'kicker' }, '아직 저금하지 않은 남은 돈'),
    el('p', { class: 'big-number' }, formatWon(h.left)),
    el('p', {}, h.month + '월 결산에서 남은 돈이 ' + formatWon(h.balance) + ' 있었어요.'
      + (h.reserve > 0 ? ' 그중 ' + formatWon(h.reserve) + '은 미리 떼어 둔 돈으로 따로 모으셨어요.' : '')
      + (h.surplus > 0 ? ' 남은 돈 모음에는 이미 ' + formatWon(h.surplus) + '을 저금하셨어요.' : '')),
    el('p', { class: 'note' }, '통장에 저금하셨다면 아래 [저금했어요]로 적어 주세요.'),
    el('button', { type: 'button', class: 'btn sub', onclick: onDismiss }, '이번엔 안 해요'));
}

// [저금했어요]·[썼어요] 단추 묶음: 목표를 채웠으면 [썼어요]가 위(주 단추), 아니면 [저금했어요]가 위. 저금통 화면과 칸 상세가 같이 쓴다.
function moveUseButtons(jar, sums, achieved, surplus) {
  const move = (primary) => el('a', { class: 'btn' + (primary ? ' primary' : ''), href: '#/jar/move/' + jar.id }, '저금했어요');
  const use = (primary) => el('a', { class: 'btn' + (primary ? ' primary' : ''), href: '#/jar/used/' + jar.id }, '썼어요');
  if (achieved) return [use(true), move(false)];
  return [move(true), (!surplus || sums.balance > 0) ? use(false) : null];
}

const NOT_REAL_MONEY = '이 앱은 실제 돈을 보관하지 않아요. 통장에 따로 저금하신 뒤에 [저금했어요]로 적어 두는 곳이에요.';

// ---- 저금통 화면: 한 화면에 칸 하나씩 (D112, D113) ----
export async function jarView(ctx) {
  const undo = ctx.jarListUndo || null;     // 방금 칸을 지웠을 때만: { id, text }
  ctx.jarListUndo = null;                   // 한 번 보여 준 뒤에는 지운다
  const box = el('section', {});
  let undone = false;
  let undoError = '';
  let helpOpen = null;                      // 처음에는 칸이 남은 돈 모음뿐이고 기록이 없을 때만 펼친다
  let hintGone = false;
  await ensureSurplusJar(ctx.db);

  async function paint() {
    const jars = await listJars(ctx.db);    // 남은 돈 모음이 맨 앞
    const reserveCount = jars.filter((j) => !isSurplus(j)).length;
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

    let idx = jars.findIndex((j) => j.id === ctx.jarPos);
    if (idx < 0) idx = 0;
    const jar = jars[idx];
    ctx.jarPos = jar.id;
    const surplus = isSurplus(jar);
    const entries = await listEntries(ctx.db, jar.id);
    const sums = sumEntries(entries);
    const nums = numbersOf(ctx, entries, sums);
    const go = (to) => async () => { ctx.jarPos = jars[to].id; await paint(); };
    if (helpOpen === null) helpOpen = reserveCount === 0 && entries.length === 0;

    // 남은 돈 안내: 남은 돈 모음 화면에서만. 계산에 실패해도 저금통은 그대로 열린다
    let hintBox = null;
    if (surplus && !hintGone) {
      try {
        const h = await getJarHint(ctx.db, (ctx.settings && ctx.settings.monthStartDay) || 1);
        if (h) hintBox = hintCard(h, async () => {
          try { await dismissJarHint(ctx.db, h.periodKey); } catch (e) { console.error(e); }
          hintGone = true; await paint();
        });
      } catch (e) { console.error(e); }
    }

    const pager = jars.length > 1 ? [
      el('p', { class: 'meta' }, (idx + 1) + ' / ' + jars.length + ' 칸'),
      el('div', { class: 'month-nav' },
        idx > 0
          ? el('button', { type: 'button', class: 'btn', onclick: go(idx - 1) }, '◀ 이전 칸')
          : el('span', { class: 'btn disabled', 'aria-disabled': 'true' }, '◀ 이전 칸'),
        idx < jars.length - 1
          ? el('button', { type: 'button', class: 'btn', onclick: go(idx + 1) }, '다음 칸 ▶')
          : el('span', { class: 'btn disabled', 'aria-disabled': 'true' }, '다음 칸 ▶')),
    ] : null;

    const achieved = isAchieved(jar, sums);
    box.replaceChildren(...[
      el('h1', {}, '저금통'),
      banner, errBox,
      pager,
      hintBox,
      summaryCard(jar, sums, nums),
      achieved ? el('div', { class: 'card' },
        el('p', { class: 'sig-line' }, el('span', { class: 'sig-shape', 'aria-hidden': 'true' }, '●'), ' 목표를 채웠어요'),
        el('p', {}, '축하드려요. 모으신 ' + formatWon(sums.balance) + '을 쓰셨다면 [썼어요]를 눌러 주세요.')) : null,
      ...moveUseButtons(jar, sums, achieved, surplus),
      el('a', { class: 'btn', href: '#/jar/open/' + jar.id }, '기록 보기·고치기'),
      reserveCount < MAX_JARS
        ? el('a', { class: 'btn', href: '#/jar/new' }, '미리 떼어 나중에 쓸 돈 칸 만들기')
        : el('p', { class: 'note' }, '미리 떼어 둔 돈 칸은 ' + MAX_JARS + '개까지 만들 수 있어요.'),
      foldButton('저금통 쓰는 법', { open: helpOpen, onToggle: async () => { helpOpen = !helpOpen; await paint(); } }),
      helpOpen ? jarHelpCard() : null,
      helpOpen ? null : el('p', { class: 'note warn' }, NOT_REAL_MONEY),
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
    const surplus = isSurplus(jar);
    // 옛 '약속으로 아낀 돈' 기록은 지우지 않고 남겨 두되, 저금통 화면에는 보이지 않는다 (D113)
    const shown = entries.filter((e) => e.kind !== 'saved');

    const banner = (undo && !undone) ? el('div', { class: 'banner', role: 'status' },
      el('span', {}, undo.text),
      el('button', {
        type: 'button', class: 'link-btn',
        onclick: async () => {
          try {
            if (undo.action === 'cancel') await softDeleteEntry(ctx.db, undo.id);
            else await restoreEntryWithTx(ctx.db, undo.id);   // 사용 기록이면 쓴 돈 기록도 함께 되살린다
            undone = true;
          } catch (e) {
            console.error(e);
            undo.text = e.userMessage || '되돌리지 못했어요. 한 번 더 눌러 주세요.';
          }
          await paint();
        },
      }, undo.label)) : null;

    box.replaceChildren(...[
      el('h1', {}, '저금통'),
      banner,
      summaryCard(jar, sums, numbersOf(ctx, entries, sums)),
      isAchieved(jar, sums) ? el('div', { class: 'card' },
        el('p', { class: 'sig-line' }, el('span', { class: 'sig-shape', 'aria-hidden': 'true' }, '●'), ' 목표를 채웠어요'),
        el('p', {}, '축하드려요. 모으신 ' + formatWon(sums.balance) + '을 쓰셨다면 [썼어요]를 눌러 주세요.')) : null,
      ...moveUseButtons(jar, sums, isAchieved(jar, sums), surplus),
      el('h2', {}, '기록'),
      shown.length === 0
        ? el('div', { class: 'card' }, el('p', { class: 'meta' }, '아직 기록이 없어요. 통장에 저금하셨다면 [저금했어요]를 눌러 주세요.'))
        : shown.map((e) => {
            const label = e.kind === 'used' ? '"쓴 돈" ' : '"저금한 돈" ';
            const body = [
              el('div', { class: 'item-main' },
                el('p', { class: 'item-title' }, label, el('span', { class: 'nowrap' }, formatDateKo(e.date))),
                (e.kind === 'used' && e.onPurpose === false) ? el('p', { class: 'meta' }, '용도 밖') : null,
                e.memo ? el('p', { class: 'meta' }, e.memo) : null),
              el('p', { class: 'item-amount' }, formatWon(e.amount)),
            ];
            // 쓴 돈은 지우는 화면으로 연결하지 않는다 (저금한 기록만 지울 수 있다)
            return e.kind !== 'moved' ? el('div', { class: 'item' }, ...body) : el('a', { class: 'item', href: '#/jar/entry/' + e.id }, ...body);
          }),
      el('hr', { class: 'sep' }),
      surplus ? null : el('a', { class: 'btn', href: '#/jar/edit/' + jar.id }, '이름·용도·목표 고치기'),
      surplus ? null : el('a', { class: 'btn', href: '#/jar/delete/' + jar.id }, '이 칸 지우기'),
      el('a', { class: 'btn', href: '#/jar' }, '저금통으로'),
    ].flat().filter(Boolean));
  }

  await paint();
  return box;
}

// ---- 칸 만들기·고치기 ----
export async function jarFormView(ctx, path, params) {
  const editing = path.indexOf('/jar/edit') === 0;
  const jars = await listReserveJars(ctx.db);
  const jar = editing ? await getJar(ctx.db, params && params.id) : null;
  if (editing && (!jar || jar.deletedAt || isSurplus(jar))) {
    return el('section', {},
      el('h1', {}, '저금통 칸을 찾지 못했어요'),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'));
  }
  if (!editing && jars.length >= MAX_JARS) {
    return el('section', {},
      el('h1', {}, '칸을 모두 만들었어요'),
      el('div', { class: 'card' }, el('p', {}, '미리 떼어 둔 돈 칸은 ' + MAX_JARS + '개까지 만들 수 있어요.')),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'));
  }
  const backHref = editing ? '#/jar/open/' + jar.id : '#/jar';

  const name = el('input', { id: 'jar-name', class: 'input', type: 'text', maxlength: '20', autocomplete: 'off', value: jar ? jar.name : '' });
  const purpose = el('input', { id: 'jar-purpose', class: 'input', type: 'text', maxlength: String(PURPOSE_MAX), autocomplete: 'off', value: jar && jar.purpose ? jar.purpose : '' });
  const purposeHint = el('p', { class: 'note' }, PURPOSE_DEFAULT_EXAMPLE);
  const target = makeAmountField({ id: 'jar-target', initial: jar ? jar.targetAmount : 0 });
  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });

  // 이미 만든 칸의 이름은 제안에서 뺀다
  const used = new Set(jars.map((j) => j.name));
  const choices = JAR_SUGGESTIONS.filter((s) => !used.has(s));
  const suggestions = (editing || choices.length === 0) ? null : el('div', {},
    el('p', { class: 'label' }, '이름을 골라 보세요'),
    el('div', { class: 'grid2' }, choices.map((s) =>
      el('button', { type: 'button', class: 'btn cat', onclick: () => { name.value = s; purposeHint.textContent = PURPOSE_EXAMPLES[s] || PURPOSE_DEFAULT_EXAMPLE; name.focus(); } }, s))));

  const save = el('button', { type: 'button', class: 'btn primary' }, editing ? '저장' : '칸 만들기');
  save.addEventListener('click', async () => {
    save.disabled = true; alertBox.hidden = true;
    try {
      const input = { name: name.value, targetAmount: target.amount, purpose: purpose.value };
      if (editing) {
        await updateJar(ctx.db, jar.id, input);
        location.hash = '#/jar/open/' + jar.id;
      } else {
        const made = await createJar(ctx.db, input);
        ctx.jarPos = made.id;               // 방금 만든 칸이 저금통 화면에 보이게 한다
        location.hash = '#/jar';
      }
    } catch (e) {
      alertBox.textContent = e.userMessage || '저장하지 못했어요. 한 번 더 눌러 주세요.';
      alertBox.hidden = false;
      save.disabled = false;
    }
  });

  return el('section', {},
    el('h1', {}, editing ? '이름·용도·목표 고치기' : '미리 떼어 나중에 쓸 돈 칸 만들기'),
    editing ? null : el('p', { class: 'note' }, '1년 안에 쓸 큰돈을 위해, 생활비에서 미리 떼어 모아 두는 칸이에요.'),
    suggestions,
    el('label', { for: 'jar-name', class: 'label' }, '칸 이름 (직접 쓰셔도 돼요)'), name,
    el('label', { for: 'jar-purpose', class: 'label' }, '무엇에 쓸 돈인가요? 한 줄로 (없어도 돼요)'), purpose, purposeHint,
    el('label', { for: 'jar-target', class: 'label' }, '필요한 금액 (원)'),
    target.input, target.reading,
    alertBox,
    save,
    el('a', { class: 'btn', href: backHref }, '뒤로'),
  );
}

// ---- [저금했어요] ----
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

  const save = el('button', { type: 'button', class: 'btn primary' }, '저금했다고 적기');
  let askedDup = false;   // SAVE-DUP: 같은 기록이 있으면 한 번 물어본다
  save.addEventListener('click', async () => {
    save.disabled = true; alertBox.hidden = true;
    try {
      if (!askedDup && await findSameMoved(ctx.db, { jarId: jar.id, amount: amount.amount, date: dateInput.value })) {
        askedDup = true;
        alertBox.textContent = '같은 날 같은 금액을 이 칸에 이미 적으셨어요. [홈]에서 [미리 떼어 나중에 쓸 돈]으로 적으신 것도 같은 기록이에요. 또 적으시겠어요?';
        alertBox.hidden = false;
        save.textContent = '네, 한 번 더 적을게요';
        save.disabled = false;
        return;
      }
      const entry = await addMoved(ctx.db, { jarId: jar.id, amount: amount.amount, date: dateInput.value, memo: memo.value });
      // 방금 적은 기록을 곧바로 취소할 수 있게 줄을 보인다 (U8)
      ctx.jarUndo = { id: entry.id, action: 'cancel', label: '방금 기록 취소', text: formatWon(entry.amount) + ' 저금했다고 적었어요.' };
      location.hash = '#/jar/open/' + jar.id;
    } catch (e) {
      alertBox.textContent = e.userMessage || '저장하지 못했어요. 한 번 더 눌러 주세요.';
      alertBox.hidden = false;
      save.disabled = false;
    }
  });

  return el('section', {},
    el('h1', {}, '얼마를 저금하셨나요?'),
    el('p', { class: 'note' }, jar.name + (isSurplus(jar) ? '에' : ' 칸에') + ' 적어 둘게요. 실제로 통장에 저금하신 뒤에 적어 주세요.'),
    ...(isSurplus(jar) ? [] : [el('p', { class: 'note' }, '[홈]에도 쓴 돈으로 함께 적혀요.'),
      ...foldBox('[홈]에 적히는 방법', [el('p', { class: 'note' }, '분류 "미리 떼어 둔 돈"으로 적혀요. 이달 결산의 "남은 돈"에서는 빠져요. [홈]의 [직접 쓰기]에서 [미리 떼어 나중에 쓸 돈]으로 적는 것과 같은 기록이에요.')])]),
    el('label', { for: 'move-amount', class: 'label' }, '금액 (원)'),
    amount.input, amount.reading,
    el('label', { for: 'move-date', class: 'label' }, '저금한 날'), dateInput,
    el('label', { for: 'move-memo', class: 'label' }, '메모 (없어도 돼요)'), memo,
    alertBox,
    save,
    el('a', { class: 'btn', href: '#/jar/open/' + jar.id }, '뒤로'),
  );
}

// ---- 저금한 기록 지우기 (두 번 확인, D60) ----
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
      await deleteEntryWithTx(ctx.db, entry);   // 사용 기록이면 쓴 돈 기록도 함께 지운다
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

// ---- [썼어요]: 어디에 쓰셨나요 -> 맞나요 -> 기록 ----
// 미리 떼어 둔 돈 칸은 모은 돈보다 많이 써도 된다(먼저 쓴 돈, 올해 안에서만). 이때 앞으로 채울지, 모자란 만큼은 보통 지출로 적을지 고른다 (D114).
// 용도를 적어 둔 칸은 쓰기 전에 "그 용도로 쓰시나요?"를 묻는다. 달라도 막지 않고, 안전한 [그만둘게요]를 위에 두고 [그래도 꺼낼게요]로 이어 간다. 꾸짖는 말은 쓰지 않는다 (D115).
export async function jarUsedView(ctx, path, params) {
  const jar = await getJar(ctx.db, params && params.id);
  if (!jar || jar.deletedAt || jar.status === 'done') {
    return el('section', {},
      el('h1', {}, jar && !jar.deletedAt ? '이미 마무리한 칸이에요' : '저금통 칸을 찾지 못했어요'),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'));
  }
  const surplus = isSurplus(jar);
  const balance = sumEntries(await listEntries(ctx.db, jar.id)).balance;
  if (surplus && balance < 1) {
    return el('section', {},
      el('h1', {}, '쓸 수 있는 돈이 없어요'),
      el('p', { class: 'note' }, '이 칸에 저금한 돈이 없어요. 먼저 [저금했어요]로 적어 주세요.'),
      el('a', { class: 'btn primary', href: '#/jar/open/' + jar.id }, '칸으로'));
  }

  // 쓴 돈 분류만, 숨기지 않은 것만 순서대로 (직접 쓰기와 같은 방식: 6개 + 더보기)
  const cats = (await dbGetAll(ctx.db, 'categories'))
    .filter((c) => c.kind === 'expense' && c.isActive !== false)
    .sort((a, b) => a.order - b.order);
  const box = el('section', {});
  let chosen = null;
  let showMore = false;
  let onPurpose = true;            // 용도와 다르게 쓰기로 했으면 false
  const amount = makeAmountField({ id: 'use-amount' });
  const dateInput = el('input', { id: 'use-date', class: 'input', type: 'date', value: todayStr() });
  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const grid = el('div', { class: 'grid2' });
  const moreBtn = foldRow(() => { showMore = !showMore; paintGrid(); });

  function paintGrid() {
    const list = showMore ? cats : cats.slice(0, 6);
    grid.replaceChildren(...list.map((c) =>
      el('button', { type: 'button', class: 'btn cat' + (chosen && chosen.id === c.id ? ' on' : ''), onclick: () => { chosen = c; paintGrid(); } },
        (chosen && chosen.id === c.id ? '✓ ' : '') + c.name)));
    moreBtn.setState('나머지 ' + (cats.length - 6) + '개 분류', showMore);
    moreBtn.hidden = cats.length <= 6;
  }

  const allBtn = balance > 0 ? el('button', { type: 'button', class: 'btn sub' }, '모은 돈 전부 (' + formatWon(balance) + ')') : null;
  if (allBtn) allBtn.addEventListener('click', () => {
    amount.input.value = String(balance);
    amount.input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  function showForm() {
    paintGrid();
    box.replaceChildren(...[
      el('h1', {}, '어디에 쓰셨나요?'),
      el('p', { class: 'note' }, balance > 0
        ? jar.name + (surplus ? '에' : ' 칸에') + ' 모은 돈은 ' + formatWon(balance) + '이에요.'
        : jar.name + ' 칸에는 아직 모은 돈이 없어요. 쓰시면 "먼저 쓴 돈"이 되고, 앞으로 저금해서 채워요.'),
      grid, moreBtn,
      el('label', { for: 'use-amount', class: 'label' }, '쓴 금액 (원)'),
      amount.input, amount.reading, allBtn,
      el('label', { for: 'use-date', class: 'label' }, '쓴 날'), dateInput,
      alertBox,
      el('button', { type: 'button', class: 'btn primary', onclick: goNext }, '다음'),
      el('a', { class: 'btn', href: '#/jar/open/' + jar.id }, '뒤로'),
    ].filter(Boolean));
  }

  // 입력을 확인하고, 용도가 적힌 칸이면 용도 확인 질문으로, 아니면 바로 맞나요 화면으로 간다
  function goNext() {
    alertBox.hidden = true;
    const a = amount.amount;
    let msg = '';
    if (!chosen) msg = '어디에 쓰셨는지 골라 주세요.';
    else if (!Number.isInteger(a) || a < 1) msg = '쓴 금액을 1원 이상으로 입력해 주세요.';
    else if (surplus && a > balance) msg = '모은 돈(' + formatWon(balance) + ')보다 많아요. 금액을 다시 확인해 주세요.';
    else if (!dateInput.value) msg = '날짜를 다시 확인해 주세요.';
    if (msg) { alertBox.textContent = msg; alertBox.hidden = false; return; }
    onPurpose = true;
    if (!surplus && jar.purpose) askPurpose(a); else goConfirm();
  }

  // 1) 이 돈을 그 용도로 쓰시나요?
  function askPurpose(a) {
    box.replaceChildren(
      el('h1', {}, '이 돈을 그 용도로 쓰시나요?'),
      el('div', { class: 'card' },
        el('p', { class: 'kicker' }, jar.name + ' 칸의 용도'),
        el('p', { class: 'big-number' }, jar.purpose),
        el('p', { class: 'meta' }, chosen.name + ' · ' + formatWon(a))),
      el('button', { type: 'button', class: 'btn primary', onclick: goConfirm }, '네, 용도대로 써요'),
      el('button', { type: 'button', class: 'btn', onclick: () => notePurpose(a) }, '용도와 달라요'),
      el('button', { type: 'button', class: 'btn sub', onclick: showForm }, '고칠게요'));
  }

  // 2) 용도가 달라도 괜찮아요. 막지 않고, 그만두는 길을 위에 둔다.
  function notePurpose(a) {
    box.replaceChildren(
      el('h1', {}, '용도가 달라도 괜찮아요'),
      el('div', { class: 'card' },
        el('p', {}, '이 칸은 "' + jar.purpose + '"을 위해 모은 돈이에요.'),
        el('p', {}, '다른 곳에 쓰셔도 되지만, 내역에 "용도 밖"이라고 표시돼요.')),
      el('a', { class: 'btn primary', href: '#/jar/open/' + jar.id }, '그만둘게요'),
      el('button', { type: 'button', class: 'btn', onclick: () => { onPurpose = false; goConfirm(); } }, '그래도 꺼낼게요'));
  }

  function goConfirm() {
    alertBox.hidden = true;
    const a = amount.amount;
    let msg = '';
    if (!chosen) msg = '어디에 쓰셨는지 골라 주세요.';
    else if (!Number.isInteger(a) || a < 1) msg = '쓴 금액을 1원 이상으로 입력해 주세요.';
    else if (surplus && a > balance) msg = '모은 돈(' + formatWon(balance) + ')보다 많아요. 금액을 다시 확인해 주세요.';
    else if (!dateInput.value) msg = '날짜를 다시 확인해 주세요.';
    if (msg) { alertBox.textContent = msg; alertBox.hidden = false; return; }

    const lack = surplus ? 0 : Math.max(0, a - Math.max(balance, 0));
    const err = el('div', { class: 'alert', role: 'alert', hidden: true });
    // 기록 단추를 누르면 run()이 저장하고 완료 화면으로 간다
    const run = (btn, fn) => async () => {
      btn.disabled = true; err.hidden = true;
      try { showDone(await fn(), a); }
      catch (e) {
        err.textContent = e.userMessage || '저장하지 못했어요. 한 번 더 눌러 주세요.';
        err.hidden = false;
        btn.disabled = false;
      }
    };
    const base = { jarId: jar.id, categoryId: chosen.id, amount: a, date: dateInput.value, onPurpose };

    const buttons = [];
    if (lack > 0) {
      const adv = el('button', { type: 'button', class: 'btn primary' }, '앞으로 모아서 채울게요 (먼저 쓴 돈)');
      adv.addEventListener('click', run(adv, () => useJar(ctx.db, { ...base, advance: true })));
      const nor = el('button', { type: 'button', class: 'btn' }, '모자란 ' + formatWon(lack) + '은 이번 달 보통 지출로 적을게요');
      nor.addEventListener('click', run(nor, () => useJarSplit(ctx.db, base)));
      buttons.push(el('p', { class: 'note' }, '칸에 모은 돈은 ' + formatWon(Math.max(balance, 0)) + '이에요. ' + formatWon(lack) + '이 모자라요.'), adv, nor);
    } else {
      const save = el('button', { type: 'button', class: 'btn primary' }, '맞아요, 기록하기');
      save.addEventListener('click', run(save, () => useJar(ctx.db, base)));
      buttons.push(save);
    }
    box.replaceChildren(
      el('h1', {}, '맞나요?'),
      el('div', { class: 'card' },
        el('p', { class: 'meta' }, jar.name + (surplus ? '' : ' 칸')),
        el('p', { class: 'big-number' }, formatWon(a)),
        el('p', {}, chosen.name + ' · ' + formatDateKo(dateInput.value))),
      el('p', { class: 'note' }, surplus
        ? '보통 쓴 돈으로 기록돼요.'
        : '미리 떼어 둔 돈에서 쓴 것으로 기록돼요.' + (onPurpose ? '' : ' 내역에 "용도 밖"이라고 표시돼요.') + ' 이달 "쓴 돈" 합계에는 넣지 않아요. 모을 때 이미 쓴 돈으로 적었어요.'),
      err, ...buttons,
      el('button', { type: 'button', class: 'btn', onclick: showForm }, '고칠게요'));
  }

  function showDone(res, a) {
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
    const fromJar = res.entry ? res.entry.amount : 0;
    box.replaceChildren(
      el('h1', {}, '기록했어요'),
      el('div', { class: 'card' },
        el('p', {}, formatWon(a) + '을 쓰신 것으로 적었어요.'),
        res.extraTransaction ? el('p', { class: 'note' }, '칸에서 ' + formatWon(fromJar) + ', 보통 지출로 ' + formatWon(res.extraTransaction.amount) + '을 적었어요.')
          : (!res.entry ? el('p', { class: 'note' }, '칸에 모은 돈이 없어서 보통 지출로 적었어요.') : null),
        res.jarDone ? el('p', { class: 'note' }, '목표만큼 모은 돈을 모두 쓰셨어요. 이 칸은 마무리했고, 새 칸을 만들 수 있어요.') : null),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'),
      undoBtn);
  }

  showForm();
  return box;
}

// ---- 칸 지우기 (확인 한 번, D60·D92) ----
export async function jarDeleteView(ctx, path, params) {
  const jar = await getJar(ctx.db, params && params.id);
  if (!jar || jar.deletedAt || isSurplus(jar)) {
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
      el('p', { class: 'row-value', style: 'white-space: normal; overflow-wrap: anywhere;' }, jar.name),
      el('p', { class: 'meta' }, '목표 ' + formatWon(jar.targetAmount) + ' · 남은 돈 ' + formatWon(sums.balance))),
    entries.length > 0
      ? el('p', { class: 'note warn' }, '이 칸의 기록 ' + entries.length + '건(저금한 돈 ' + formatWon(sums.moved) + ' 포함)도 함께 보이지 않게 돼요.')
      : null,
    sums.balance < 0
      ? el('p', { class: 'note warn' }, '먼저 쓴 돈 ' + formatWon(-sums.balance) + '이 남아 있어서 지울 수 없어요. 저금해서 먼저 채워 주세요.')
      : sums.moved > 0
        ? el('p', { class: 'note' }, '홈에 쓴 돈으로 적힌 기록은 지워지지 않고 그대로 남아요.')
        : null,
    el('p', { class: 'note' }, '지운 직후에는 [저금통]에서 [되돌리기]를 누를 수 있어요.'),
    alertBox,
    el('a', { class: 'btn primary', href: backHref }, '그만둘게요'),
    sums.balance < 0 ? null : really,
  );
}

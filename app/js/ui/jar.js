// S9 저금통 (화면흐름 v1.2): 칸 1개 만들기와 [옮겼어요] 체크
// 저금통은 가상이다. 앱이 돈을 보관하지 않고, 실제로 옮긴 것을 체크해 두는 곳이다 (R06).
// 2단계에서는 칸 만들기와 [옮겼어요]만 있다. 계산된 아낀 돈과 목표 달성은 4단계에서 연결한다.
import { el } from './dom.js';
import { formatWon, formatDateKo } from './format.js';
import { makeAmountField } from './amountField.js';
import { todayStr } from '../storage/dates.js';
import {
  MAX_JARS, JAR_SUGGESTIONS, listJars, getJar, createJar, updateJar,
  addMoved, listEntries, softDeleteEntry, restoreEntry, sumEntries, fillPercent,
} from '../storage/jars.js';

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

// ---- 저금통 화면 ----
export async function jarView(ctx) {
  const jars = await listJars(ctx.db);

  if (jars.length === 0) {
    return el('section', {},
      el('h1', {}, '저금통'),
      el('div', { class: 'card' },
        el('p', {}, '아직 저금통 칸이 없어요.'),
        el('p', { class: 'muted' }, '칸은 돈을 모으는 목적 하나예요. 예를 들면 "손주 선물"처럼 이름을 붙이고 목표 금액을 정해요.'),
        el('p', { class: 'muted' }, '이 앱은 실제 돈을 보관하지 않아요. 통장에서 돈을 따로 옮기신 뒤에 [옮겼어요]로 적어 두는 곳이에요.')),
      el('a', { class: 'btn primary', href: '#/jar/new' }, '칸 만들기'),
    );
  }

  const jar = jars[0];
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
        jarProgress(jar, sums),
        el('p', { class: 'muted tight' }, '옮긴 돈'),
        el('p', { class: 'big-number tight' }, formatWon(sums.balance)),
        // 금액이 길어도 한 줄에서 잘리지 않게 목표와 남은 금액을 줄 바꿔 보인다
        el('p', { class: 'muted line-tight' }, '목표 ' + formatWon(jar.targetAmount)),
        el('p', { class: 'muted line-tight' }, remain > 0 ? '앞으로 ' + formatWon(remain) : '목표를 채웠어요')),
      el('a', { class: 'btn primary', href: '#/jar/move' }, '옮겼어요'),
      el('h2', {}, '옮긴 기록'),
      entries.length === 0
        ? el('div', { class: 'card' }, el('p', { class: 'muted' }, '아직 옮긴 기록이 없어요. 통장에서 돈을 옮기셨다면 [옮겼어요]를 눌러 주세요.'))
        : entries.map((e) => el('a', { class: 'item', href: '#/jar/entry/' + e.id },
            el('div', { class: 'item-main' },
              el('p', { class: 'item-title' }, formatDateKo(e.date)),
              e.memo ? el('p', { class: 'muted small' }, e.memo) : null),
            el('p', { class: 'item-amount' }, formatWon(e.amount)))),
      el('hr', { class: 'sep' }),
      el('a', { class: 'btn', href: '#/jar/edit' }, '이름·목표 고치기'),
      el('p', { class: 'muted small' }, '현재는 저금통 칸은 하나만 만들 수 있어요. 나중에는 목적별로 3개까지 만들 수 있게 할 예정이에요.'),
    ].flat().filter(Boolean));
  }

  await paint();
  return box;
}

// ---- 칸 만들기·고치기 ----
export async function jarFormView(ctx, path) {
  const editing = path === '/jar/edit';
  const jars = await listJars(ctx.db);
  const jar = editing ? jars[0] : null;
  if (editing && !jar) {
    return el('section', {},
      el('h1', {}, '저금통 칸이 없어요'),
      el('a', { class: 'btn primary', href: '#/jar/new' }, '칸 만들기'));
  }
  if (!editing && jars.length >= MAX_JARS) {
    return el('section', {},
      el('h1', {}, '이미 칸이 있어요'),
      el('div', { class: 'card' }, el('p', {}, '지금은 저금통 칸을 ' + MAX_JARS + '개까지 만들 수 있어요.')),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'));
  }

  const name = el('input', { id: 'jar-name', class: 'input', type: 'text', maxlength: '20', autocomplete: 'off', value: jar ? jar.name : '' });
  const target = makeAmountField({ id: 'jar-target', initial: jar ? jar.targetAmount : 0 });
  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });

  const suggestions = editing ? null : el('div', {},
    el('p', { class: 'label' }, '이름을 골라 보세요'),
    el('div', { class: 'grid2' }, JAR_SUGGESTIONS.map((s) =>
      el('button', { type: 'button', class: 'btn cat', onclick: () => { name.value = s; name.focus(); } }, s))));

  const save = el('button', { type: 'button', class: 'btn primary' }, editing ? '저장' : '칸 만들기');
  save.addEventListener('click', async () => {
    save.disabled = true; alertBox.hidden = true;
    try {
      const input = { name: name.value, targetAmount: target.amount };
      if (editing) await updateJar(ctx.db, jar.id, input);
      else await createJar(ctx.db, input);
      location.hash = '#/jar';
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
    el('a', { class: 'btn', href: '#/jar' }, '뒤로'),
  );
}

// ---- [옮겼어요] ----
export async function jarMoveView(ctx) {
  const jars = await listJars(ctx.db);
  const jar = jars[0];
  if (!jar) {
    return el('section', {},
      el('h1', {}, '먼저 칸을 만들어요'),
      el('a', { class: 'btn primary', href: '#/jar/new' }, '칸 만들기'));
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
      location.hash = '#/jar';
    } catch (e) {
      alertBox.textContent = e.userMessage || '저장하지 못했어요. 한 번 더 눌러 주세요.';
      alertBox.hidden = false;
      save.disabled = false;
    }
  });

  return el('section', {},
    el('h1', {}, '얼마를 옮기셨나요?'),
    el('p', { class: 'muted' }, jar.name + ' 칸에 적어 둘게요. 실제로 통장에서 옮기신 뒤에 적어 주세요.'),
    el('label', { for: 'move-amount', class: 'label' }, '금액 (원)'),
    amount.input, amount.reading,
    el('label', { for: 'move-date', class: 'label' }, '옮긴 날'), dateInput,
    el('label', { for: 'move-memo', class: 'label' }, '메모 (없어도 돼요)'), memo,
    alertBox,
    save,
    el('a', { class: 'btn', href: '#/jar' }, '뒤로'),
  );
}

// ---- 옮긴 기록 지우기 (두 번 확인, D60) ----
export async function jarEntryView(ctx, path, params) {
  const all = await listJars(ctx.db);
  const jar = all[0];
  const entries = jar ? await listEntries(ctx.db, jar.id) : [];
  const entry = entries.find((e) => e.id === params.id);
  if (!entry) {
    return el('section', {},
      el('h1', {}, '기록을 찾지 못했어요'),
      el('a', { class: 'btn primary', href: '#/jar' }, '저금통으로'));
  }
  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const really = el('button', { type: 'button', class: 'btn danger' }, '지울게요');
  really.addEventListener('click', async () => {
    really.disabled = true;
    try {
      await softDeleteEntry(ctx.db, entry.id);
      ctx.jarUndo = { id: entry.id, action: 'restore', label: '되돌리기', text: formatDateKo(entry.date) + ' ' + formatWon(entry.amount) + ' 기록을 지웠어요.' };
      location.hash = '#/jar';
    } catch (e) {
      alertBox.textContent = '지우지 못했어요. 한 번 더 눌러 주세요.';
      alertBox.hidden = false;
      really.disabled = false;
    }
  });
  return el('section', {},
    el('h1', {}, '이 기록을 지울까요?'),
    el('div', { class: 'card' },
      el('p', { class: 'row-value' }, formatWon(entry.amount)),
      el('p', { class: 'muted' }, formatDateKo(entry.date) + (entry.memo ? ' · ' + entry.memo : ''))),
    alertBox,
    el('a', { class: 'btn primary', href: '#/jar' }, '그만둘게요'),
    really,
    el('p', { class: 'muted small' }, '지워도 바로 되돌릴 수 있어요.'),
  );
}

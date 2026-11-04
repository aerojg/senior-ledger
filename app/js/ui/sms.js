/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// S2 문자 붙여넣기와 S3 인식 확인 (화면흐름 v1.1, 문자인식규칙 v1.0, D38·D39)
// 붙여넣은 뒤에는 항상 확인 카드를 거치고 자동 저장은 하지 않는다.
// 못 읽은 칸은 비워 표시하고 채우기 전에는 저장할 수 없다. 색만으로 구분하지 않는다(U5).
import { el } from './dom.js';
import { foldButton } from './fold.js';
import { formatWon, koreanAmount, formatDateKo } from './format.js';
import { todayStr } from '../storage/dates.js';
import { dbGetAll } from '../storage/db.js';
import { PAY_METHODS, INCOME_PAY_METHODS } from './write.js';
import { costTypeField } from './costType.js'; // COST-TYPE-ENTRY
import { parseSms } from '../parser/sms.js';
import { findRecordedKeys, getLearnedMerchant, learnMerchant, saveSmsItems } from '../storage/smsRecords.js';
import { listReserveJars, addMoved } from '../storage/jars.js'; // SAVE-SMS
import { deleteEntryWithTx } from '../storage/jarUse.js'; // SAVE-SMS

// ---------- S2 문자 붙여넣기 ----------
export async function smsPasteView(ctx) {
  // 붙여넣기 화면은 들어올 때마다 빈 칸으로 시작한다 (이전에 붙인 글이 남아 헷갈리지 않게)
  ctx.peekText = null;
  ctx.sms = null;
  ctx.smsText = '';

  const box = el('textarea', {
    id: 'sms-text', class: 'input textarea', rows: '7', autocomplete: 'off', spellcheck: 'false',
    'aria-describedby': 'sms-hint', placeholder: '여기에 결제 문자를 붙여 넣으세요',
  });

  const hint = el('p', { id: 'sms-hint', class: 'muted hint', 'aria-live': 'polite' });
  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const go = el('button', { type: 'button', class: 'btn primary' }, '다 붙였어요');

  function refresh() {
    const has = box.value.trim() !== '';
    go.disabled = !has;
    hint.textContent = has ? '' : '문자를 붙여 넣으면 다음으로 갈 수 있어요.';
  }
  box.addEventListener('input', () => { ctx.smsText = box.value; alertBox.hidden = true; refresh(); });

  function showAlert(message) { alertBox.textContent = message; alertBox.hidden = false; }

  go.addEventListener('click', async () => {
    go.disabled = true;
    alertBox.hidden = true;
    try {
      const text = box.value;
      const parsed = await parseSms(text);
      if (parsed.items.length === 0) {
        showAlert('붙여 넣은 글에서 결제 문자를 찾지 못했어요. 문자를 다시 복사해서 붙여 넣어 주세요.');
        go.disabled = false;
        return;
      }
      ctx.smsText = text;
      ctx.sms = await buildSmsState(ctx, parsed);
      location.hash = '#/sms/check';
    } catch (e) {
      console.error(e);
      showAlert('문자를 읽다가 문제가 생겼어요. 한 번 더 눌러 주세요.');
      go.disabled = false;
    }
  });

  refresh();
  return el('section', {},
    el('h1', {}, '결제 문자를 붙여 넣어 주세요'),
    el('ol', { class: 'steps' },
      el('li', {}, '문자 앱에서 결제 문자를 복사해요.'),
      el('li', {}, '이 앱으로 돌아와요.'),
      el('li', {}, '아래 칸에 붙여 넣어요.')),
    el('p', { class: 'note' }, '쓴 돈인지 받은 돈인지는 문자 내용을 보고 자동으로 나눕니다. 다음 화면에서 맞는지 확인하고 바꿀 수 있어요.'),
    box,
    hint,
    alertBox,
    go,
    el('a', { class: 'btn', href: '#/home' }, '홈으로'),
  );
}

// ---------- 읽은 결과를 확인 카드용 상태로 바꾼다 ----------
async function buildSmsState(ctx, parsed) {
  const all = await dbGetAll(ctx.db, 'categories');
  const cats = all.filter((c) => c.isActive).sort((a, b) => a.order - b.order);
  const kindOf = new Map(cats.map((c) => [c.id, c.kind]));

  const jars = await listReserveJars(ctx.db); // SAVE-SMS: 미리 떼어 둔 돈 칸 (이체 문자를 칸에 모은 돈으로 적을 때 고른다)
  const readable = parsed.items.filter((i) => i.ok);
  const recorded = await findRecordedKeys(ctx.db, readable.map((i) => i.dedupeKey));

  const states = [];
  for (const item of readable) {
    const st = {
      item,
      include: true,
      dupe: null,                 // 'db' = 이미 기록한 문자, 'paste' = 같은 글이 한 번 더 붙음
      jarId: '',                  // SAVE-SMS: 'save'(미리 떼어 나중에 쓸 돈)로 답했을 때 고른 칸
      answer: item.ask === 'card' ? 'record' : null,   // 'record' = 읽은 그대로 기록, 'transfer' = 이체로 기록 (카드값은 지출이 기본, D39)
      categoryId: item.suggestedCategoryId || '',
      date: item.date,
      merchant: item.merchant,
      memo: '',
      payMethod: item.type === 'expense' ? 'debit' : 'account',   // 처음 보이는 값. 저장 전에 바꿀 수 있다
      typeOverride: null,        // 사용자가 쓴 돈/받은 돈을 바꾼 경우 'expense' | 'income'
      pickerOpen: false,
      showMore: false,
      learned: false,
    };

    // 지난번에 고른 것을 미리 채운다 (가맹점 학습)
    const m = await getLearnedMerchant(ctx.db, item.merchant);
    if (m) {
      if (item.type === 'expense') {
        if (m.learnedType === 'transfer') { st.answer = 'transfer'; st.learned = true; }
        else if (m.learnedType === 'save') {
          // 지난번에 미리 떼어 둔 돈 칸에 모았다: 그 칸이 아직 있고 마무리되지 않았을 때만 미리 채운다
          const jar = jars.find((j) => j.id === m.jarId);
          if (jar && jar.status !== 'done') { st.answer = 'save'; st.jarId = jar.id; st.learned = true; }
        }
        else if (m.learnedType === 'expense') {
          if (item.ask) st.answer = 'record';
          if (m.categoryId && kindOf.get(m.categoryId) === 'expense') { st.categoryId = m.categoryId; st.learned = true; }
        }
      } else if (m.categoryId && kindOf.get(m.categoryId) === 'income') {
        st.categoryId = m.categoryId; st.learned = true;
        if (item.ask) st.answer = 'record';
      }
    }

    // 지난번에 직접 바꾼 구분도 같은 분류일 때만 미리 채운다 (구분 기억)
    if (m && m.costType && item.type === 'expense' && st.answer !== 'transfer' && m.costTypeFor === st.categoryId && st.categoryId) {
      st.costType = m.costType; st.costTypeFor = st.categoryId; st.learned = true;
    }

    if (recorded.has(item.dedupeKey)) { st.dupe = 'db'; st.include = false; }
    else if (item.duplicateInPaste) { st.dupe = 'paste'; st.include = false; }
    states.push(st);
  }
  const reasons = parsed.items.filter((i) => !i.ok).map((i) => i.reason || 'notSms');
  return { states, unreadable: parsed.unreadable, reasons, readable: readable.length, categories: cats, jars };
}

// 읽지 못한 이유를 쉬운 말로 (사유 코드 -> 글)
const REASON_TEXT = {
  noAmount: '금액을 찾지 못했어요.',
  noKind: '돈이 나간 문자인지 들어온 문자인지 알려 주는 말(출금·입금·승인)을 찾지 못했어요.',
  cancel: '취소된 결제 문자는 자동으로 읽지 않아요.',
  notSms: '결제나 입출금 문자가 아닌 것 같아요.',
};
const reasonText = (code) => REASON_TEXT[code] || REASON_TEXT.notSms;

// ---------- 카드 한 장의 판단 ----------
const baseType = (st) => st.typeOverride || st.item.type;
const effType = (st) => (st.typeOverride ? baseType(st) : st.answer === 'transfer' ? 'transfer' : st.answer === 'save' ? 'save' : baseType(st));
// 질문 블록이 필요한가: 문자인식규칙 4번의 질문, 또는 지난번에 이체로 기록한 가맹점
const blockKind = (st) => ((st.typeOverride || st.answer === 'save') ? null : (st.item.ask || (st.answer === 'transfer' ? 'person' : null)));   // SAVE-SMS: 위쪽 종류 단추에서 [미리 떼어 나중에 쓸 돈]을 고르면 질문은 없다

function needs(st) {
  if (!st.date) return '날짜를 골라 주세요';
  if (!st.merchant.trim()) return '가게 이름을 적어 주세요';
  if (blockKind(st) && st.answer === null) return '아래 질문에 답해 주세요';
  if (effType(st) === 'save' && !st.jarId) return '모을 칸을 골라 주세요';
  if (effType(st) !== 'transfer' && effType(st) !== 'save' && !st.categoryId) return '분류를 골라 주세요';
  return '';
}

// 구분: 사용자가 이 분류에서 고른 값이 있으면 그것, 없으면 분류의 기본값 (분류를 바꾸면 다시 기본값)
const costOf = (st, cat) => ((st.costType && st.costTypeFor === cat.id) ? st.costType : cat.costTypeDefault);

const TYPE_LABEL = { expense: '쓴 돈 (지출)', income: '받은 돈 (수입)', transfer: '옮긴 돈 (이체)', save: '미리 떼어 나중에 쓸 돈 (지출 유보 적립)' };

// ---------- S3 인식 확인 ----------
export async function smsCheckView(ctx) {
  const sms = ctx.sms;
  if (!sms) { location.replace('#/sms'); return el('section'); }

  // 하나도 못 읽은 경우: 다음 할 일 한 가지만 안내한다 (U9)
  if (sms.readable === 0) return failureView(ctx);

  const expenseCats = sms.categories.filter((c) => c.kind === 'expense');
  const incomeCats = sms.categories.filter((c) => c.kind === 'income');

  // 확인이 필요한 건을 맨 위에 둔다. 한 번 정한 순서는 고치는 동안 바꾸지 않는다.
  const groupOf = (st) => (!st.include ? 2 : needs(st) ? 0 : 1);
  const ordered = sms.states.map((st, i) => ({ st, i })).sort((a, b) => groupOf(a.st) - groupOf(b.st) || a.i - b.i).map((x) => x.st);

  const list = el('div', {});
  const footer = el('div', {});
  const cardOf = new Map();

  function repaintCard(st) {
    const fresh = renderCard(st);
    const old = cardOf.get(st);
    if (old && old.isConnected) old.replaceWith(fresh);
    cardOf.set(st, fresh);
    refreshFooter();
  }

  function renderCard(st) {
    const type = effType(st);
    const reason = st.include ? needs(st) : '';
    const box = el('article', { class: 'card sms-card' + (!st.include ? ' off' : '') + (reason ? ' attention' : '') });

    // 위쪽 상태 한 줄: 글자와 기호로 말한다 (색만으로 구분하지 않음)
    let status;
    if (!st.include) status = st.dupe === 'db' ? '— 이미 기록돼 있어요' : st.dupe === 'paste' ? '— 같은 문자가 한 번 더 붙어 있어요' : '— 이 건은 저장하지 않아요';
    else if (reason) status = '⚠ 확인해 주세요: ' + reason;
    else status = '✓ 저장할 수 있어요';
    box.append(el('p', { class: 'sms-status' }, status));
    if (st.item.generic && st.include) box.append(el('p', { class: 'note' }, '문자 모양이 달라서 짐작해서 읽었어요. 금액과 가게 이름을 꼭 확인해 주세요.'));
    if (st.learned && st.include) box.append(el('p', { class: 'note' }, '지난번에 고른 대로 미리 채웠어요.'));

    box.append(el('p', { class: 'kicker' }, TYPE_LABEL[type]));
    if (st.include) {
      const typeBtn = (value, label) => {
        const on = baseType(st) === value && type !== 'transfer' && type !== 'save';
        const b = el('button', { type: 'button', class: 'btn seg' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false' }, (on ? '✓ ' : '') + label);
        b.addEventListener('click', () => {
          if (baseType(st) === value && !(type === 'transfer' || type === 'save')) return;
          st.typeOverride = value === st.item.type ? null : value;
          st.answer = st.typeOverride ? null : ((st.item.ask === 'card' || type === 'save') ? 'record' : null);   // 저금에서 [쓴 돈]으로 돌아오면 질문은 다시 묻지 않는다
          st.categoryId = st.typeOverride ? (value === 'income' ? 'i03' : '') : (st.item.suggestedCategoryId || '');
          st.payMethod = value === 'income' ? 'account' : 'debit';
          st.pickerOpen = false; st.showMore = false;
          repaintCard(st);
        });
        return b;
      };
      // SAVE-SMS: 돈이 나간 문자라면 어떤 문자든(이체 문자 포함) [미리 떼어 나중에 쓸 돈]으로 적을 수 있다. 미리 떼어 둔 돈 칸이 있을 때만
      const canSaveType = st.item.type === 'expense' && sms.jars.length > 0;
      const saveBtn = !canSaveType ? null : (() => {
        const on = type === 'save';
        const b = el('button', { type: 'button', class: 'btn seg' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false' }, (on ? '✓ ' : '') + '미리 떼어 나중에 쓸 돈 (지출 유보 적립)');
        b.addEventListener('click', () => {
          if (type === 'save') return;
          st.typeOverride = null; st.answer = 'save';
          if (sms.jars.length === 1) st.jarId = sms.jars[0].id;   // 칸이 하나면 미리 골라 둔다(눈으로 확인할 수 있다)
          st.pickerOpen = false; st.showMore = false;
          repaintCard(st);
        });
        return b;
      })();
      box.append(el('p', { class: 'note' }, '쓴 돈인지 받은 돈인지 문자를 보고 자동으로 나눴어요. 다르면 아래에서 바꿔 주세요.' + (canSaveType ? ' [저금통]의 미리 떼어 둔 돈 칸에 모으는 이체라면 가운데 단추를 눌러 주세요.' : '')),
        saveBtn
          ? el('div', {}, typeBtn('expense', '쓴 돈 (지출)'), saveBtn, typeBtn('income', '받은 돈 (수입)'))
          : el('div', { class: 'grid2 tight-grid' }, typeBtn('expense', '쓴 돈 (지출)'), typeBtn('income', '받은 돈 (수입)')));
    }

    // 가게 이름: 읽었으면 그대로 보이고, 못 읽었으면 적게 한다
    if (st.item.merchant) {
      box.append(el('p', { class: 'item-title' }, st.item.merchant));
    } else {
      const input = el('input', { class: 'input', type: 'text', maxlength: '40', autocomplete: 'off', 'aria-label': '가게 이름', placeholder: '가게 이름을 읽지 못했어요. 적어 주세요', value: st.merchant });
      input.addEventListener('change', () => { st.merchant = input.value.trim(); repaintCard(st); });
      box.append(input);
    }

    box.append(
      el('p', { class: 'big-number' }, formatWon(st.item.amount)),
      el('p', { class: 'reading left' }, koreanAmount(st.item.amount)));

    // 날짜: 읽었으면 그대로, 못 읽었으면 고르게 한다
    if (st.item.date) {
      box.append(el('p', {}, formatDateKo(st.item.date) + (st.item.time ? ' ' + st.item.time : '')));
    } else {
      const dateInput = el('input', { class: 'input', type: 'date', max: todayStr(), 'aria-label': '날짜', value: st.date || '' });
      dateInput.addEventListener('change', () => { st.date = dateInput.value; repaintCard(st); });
      box.append(el('p', { class: 'label' }, '날짜를 읽지 못했어요. 골라 주세요'), dateInput);
    }

    // 질문 블록 (D39)
    const kind = blockKind(st);
    if (kind && st.include) {
      const isIncome = st.item.type === 'income';   // 질문은 문자 원래 종류 기준 (바꾼 경우에는 질문이 없다)
      const title = kind === 'card' ? '이 돈은 카드값인가요?' : isIncome ? '누구에게서 받은 돈인가요?' : '누구에게 보낸 돈인가요?';
      const recordLabel = isIncome ? '받은 돈으로 기록 (수입)' : '쓴 돈으로 기록 (지출)';
      const transferLabel = kind === 'card' ? '내 카드값이에요 (이체로 기록)' : isIncome ? '내 다른 통장에서 옮겨 온 돈 (이체)' : '내 다른 통장으로 옮긴 돈 (이체)';
      const choice = (value, label) => {
        const on = st.answer === value;
        const b = el('button', { type: 'button', class: 'btn seg' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false' }, (on ? '✓ ' : '') + label);
        b.addEventListener('click', () => { st.answer = value; if (value === 'save' && sms.jars.length === 1) st.jarId = sms.jars[0].id; st.pickerOpen = false; repaintCard(st); });
        return b;
      };
      box.append(el('div', { class: 'ask' }, el('p', { class: 'label' }, title), choice('record', recordLabel), choice('transfer', transferLabel),
        el('p', { class: 'note' }, '이체로 기록하는 항목을 고르면 내역에는 "이체"로 남지만, 쓴 돈(지출)에는 들어가지 않고 결산에서도 빠져요.')));
    }

    // SAVE-SMS: 어느 칸에 모으는지 고른다 (질문 블록의 선택지로 들어왔든 가운데 종류 단추로 들어왔든 같은 상자)
    if (st.include && type === 'save') {
      box.append(el('p', { class: 'label' }, '어느 칸에 모으시나요?'),
        ...sms.jars.map((j) => {
          const on = st.jarId === j.id;
          const b = el('button', { type: 'button', class: 'btn cat' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false' }, (on ? '✓ ' : '') + j.name);
          b.addEventListener('click', () => { st.jarId = j.id; repaintCard(st); });
          return b;
        }),
        el('p', { class: 'note' }, '지출 유보 적립금으로 [저금통]의 이 칸에 적립돼요. 이번 달 "쓴 돈"에 들어가요. 같은 돈을 [직접 쓰기]로 또 적지 마세요.'));
    }

    // 분류 (이체가 아닐 때, 그리고 질문에 답한 뒤)
    const needAnswerFirst = kind && st.answer === null;
    if (st.include && type !== 'transfer' && type !== 'save' && !needAnswerFirst) {
      const cats = type === 'income' ? incomeCats : expenseCats;
      const current = cats.find((c) => c.id === st.categoryId);
      if (current && !st.pickerOpen) {
        box.append(el('div', { class: 'row' },
          el('div', {}, el('p', { class: 'kicker' }, '분류'), el('p', { class: 'row-value', style: 'white-space: normal; overflow-wrap: anywhere;' }, current.name)),
          el('button', { type: 'button', class: 'link-btn', onclick: () => { st.pickerOpen = true; repaintCard(st); } }, '바꾸기')));
      } else {
        box.append(el('p', { class: 'label' }, type === 'income' ? '어떤 돈인가요? 골라 주세요' : '어디에 쓰셨나요? 골라 주세요'));
        const main = type === 'income' ? cats : (st.showMore ? cats : cats.slice(0, 6));
        const grid = el('div', { class: 'grid2' }, main.map((c) => {
          const on = st.categoryId === c.id;
          const b = el('button', { type: 'button', class: 'btn cat' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false' }, (on ? '✓ ' : '') + c.name);
          b.addEventListener('click', () => { st.categoryId = c.id; st.pickerOpen = false; repaintCard(st); });
          return b;
        }));
        box.append(grid);
        if (type !== 'income' && cats.length > 6) {
          box.append(foldButton('나머지 ' + (cats.length - 6) + '개 분류', { open: st.showMore, onToggle: () => { st.showMore = !st.showMore; repaintCard(st); } }));
        }
      }
    }

    // 구분(고정비·변동비·일회성): 쓴 돈이고 분류를 고른 뒤에만 보인다. 분류를 바꾸면 그 분류의 기본값으로 돌아간다. COST-TYPE-ENTRY
    if (st.include && type === 'expense' && !needAnswerFirst) {
      const cat = expenseCats.find((c) => c.id === st.categoryId);
      if (cat) {
        box.append(costTypeField({
          get: () => costOf(st, cat),
          set: (v) => { st.costType = v; st.costTypeFor = cat.id; },
          getDefault: () => cat.costTypeDefault,
        }));
      }
    }

    // 결제방법 (이체로 기록할 때는 없다). 처음에는 쓴 돈 = 체크카드, 받은 돈 = 통장으로 받음
    if (st.include && type !== 'transfer' && type !== 'save') {
      const payId = 'pay-' + Math.random().toString(36).slice(2, 8);
      const list = type === 'income' ? INCOME_PAY_METHODS : PAY_METHODS;
      const paySel = el('select', { id: payId, class: 'input' },
        list.map(([value, label]) => el('option', { value, selected: st.payMethod === value }, label)));
      paySel.addEventListener('change', () => { st.payMethod = paySel.value; });
      box.append(el('label', { for: payId, class: 'label' }, type === 'income' ? '어떻게 받으셨나요?' : '어떻게 쓰셨나요?'), paySel);
    }

    // 메모 (저장 전에 적을 수 있다, 없으면 비워 둔다)
    if (st.include) {
      const memoId = 'memo-' + Math.random().toString(36).slice(2, 8);
      const memoInput = el('input', { id: memoId, class: 'input', type: 'text', maxlength: '60', autocomplete: 'off', value: st.memo });
      memoInput.addEventListener('input', () => { st.memo = memoInput.value; });
      box.append(el('label', { for: memoId, class: 'label' }, '메모 (없으면 비워 두세요)'), memoInput);
    }

    // 빼기/넣기 단추
    if (st.include) {
      box.append(el('button', { type: 'button', class: 'btn sub', onclick: () => { st.include = false; repaintCard(st); } }, '이 건 빼기'));
    } else {
      box.append(el('button', { type: 'button', class: 'btn sub', onclick: () => { st.include = true; repaintCard(st); } }, st.dupe ? '그래도 기록' : '다시 넣기'));
    }
    return box;
  }

  function refreshFooter() {
    const included = sms.states.filter((s) => s.include);
    const blocked = included.filter((s) => needs(s));
    const save = el('button', { type: 'button', class: 'btn primary' });
    let note = '';
    if (included.length === 0) { save.textContent = '저장할 건이 없어요'; save.disabled = true; note = '저장할 건을 [다시 넣기]로 넣어 주세요.'; }
    else if (blocked.length > 0) { save.textContent = '저장'; save.disabled = true; note = '확인이 필요한 건이 ' + blocked.length + '개 있어요. 위쪽 ⚠ 표시가 있는 카드를 확인해 주세요.'; }
    else { save.textContent = included.length + '건 저장'; }
    const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });

    save.addEventListener('click', async () => {
      save.disabled = true;
      alertBox.hidden = true;
      try {
        const deposits = included.filter((st) => effType(st) === 'save');   // SAVE-SMS: 칸에 모은 돈은 따로 저장한다
        const entries = included.filter((st) => effType(st) !== 'save').map((st) => {
          const type = effType(st);
          return {
            type, date: st.date, time: st.item.time, amount: st.item.amount, merchant: st.merchant.trim(),
            categoryId: type === 'transfer' ? '' : st.categoryId,
            transferKind: type === 'transfer' ? (st.item.ask === 'card' ? 'cardBill' : 'etc') : undefined,
            memo: st.memo.trim(),
            costType: type === 'expense' ? costOf(st, expenseCats.find((c) => c.id === st.categoryId) || { costTypeDefault: 'variable' }) : undefined,
            costDefault: type === 'expense' ? ((expenseCats.find((c) => c.id === st.categoryId) || {}).costTypeDefault || 'variable') : undefined,
            payMethod: type === 'transfer' ? 'account' : st.payMethod,
            dedupeKey: st.item.dedupeKey,
            direction: baseType(st) === 'expense' ? 'out' : 'in',
          };
        });
        const jarDeposits = [];
        try {
          for (const st of deposits) {
            jarDeposits.push(await addMoved(ctx.db, {
              jarId: st.jarId, amount: st.item.amount, date: st.date,
              memo: (st.merchant.trim() + (st.memo.trim() ? ' · ' + st.memo.trim() : '')).trim(),
              dedupeKey: st.item.dedupeKey,
            }));
          }
        } catch (e) {
          for (const d of jarDeposits) { try { await deleteEntryWithTx(ctx.db, d); } catch (e2) { console.error(e2); } }
          throw e;
        }
        for (const st of deposits) {
          // 가맹점 학습: 같은 가게의 다음 문자는 이 칸으로 미리 채운다 (돈이 나간 문자만)
          if (baseType(st) === 'expense' && st.merchant.trim()) { try { await learnMerchant(ctx.db, st.merchant.trim(), { learnedType: 'save', jarId: st.jarId }); } catch (e) { console.error(e); } }
        }
        let ids = [];
        try {
          if (entries.length > 0) ids = (await saveSmsItems(ctx.db, entries)).ids;
        } catch (e) {
          for (const d of jarDeposits) { try { await deleteEntryWithTx(ctx.db, d); } catch (e2) { console.error(e2); } }
          throw e;
        }
        const depositSum = deposits.reduce((s, st) => s + st.item.amount, 0);
        ctx.lastSaved = {
          ids, jarDeposits, batchCount: ids.length + jarDeposits.length,
          summary: [summarize(entries), depositSum ? '칸에 모은 돈 ' + formatWon(depositSum) : ''].filter(Boolean).join(' · '),
        };
        ctx.sms = null; ctx.smsText = '';
        location.hash = '#/done';
      } catch (e) {
        console.error(e);
        alertBox.textContent = e.userMessage || '저장하지 못했어요. 한 번 더 눌러 주세요.';
        alertBox.hidden = false;
        save.disabled = false;
      }
    });

    // replaceChildren은 빈 값(null)을 "null"이라는 글자로 바꿔 버리므로 빈 값은 미리 뺀다
    footer.replaceChildren(...[
      note ? el('p', { class: 'muted hint', role: 'status' }, note) : null,
      alertBox,
      save,
      el('a', { class: 'btn', href: '#/sms' }, '다시 붙여넣기'),
    ].filter(Boolean));
  }

  for (const st of ordered) {
    const card = renderCard(st);
    cardOf.set(st, card);
    list.append(card);
  }
  refreshFooter();

  const unreadableNote = sms.unreadable > 0
    ? el('div', { class: 'card' },
        el('p', {}, '읽지 못한 문자가 ' + sms.unreadable + '건 있어요.'),
        el('p', { class: 'meta' }, reasonText(sms.reasons[0]) + ' 이 건은 [직접 쓰기]로 기록해 주세요.'),
        el('a', { class: 'btn', href: '#/write' }, '직접 쓰기로 기록하기'))
    : null;

  return el('section', {},
    el('h1', {}, sms.readable + '건을 찾았어요'),
    el('p', { class: 'note' }, '맞는지 확인하고 저장해 주세요. 저장하기 전에는 아무것도 기록되지 않아요.'),
    list,
    unreadableNote,
    footer,
  );
}

function summarize(entries) {
  const sum = (type) => entries.filter((e) => e.type === type).reduce((s, e) => s + e.amount, 0);
  const parts = [];
  if (sum('expense')) parts.push('쓴 돈 ' + formatWon(sum('expense')));
  if (sum('income')) parts.push('받은 돈 ' + formatWon(sum('income')));
  if (sum('transfer')) parts.push('옮긴 돈 ' + formatWon(sum('transfer')));
  return parts.join(' · ');
}

// 문자를 아예 못 읽었을 때: 붙여넣은 글을 보면서 직접 쓰게 한다 (문자인식규칙 5번)
function failureView(ctx) {
  const text = ctx.smsText || '';
  return el('section', {},
    el('h1', {}, '이 문자는 읽지 못했어요'),
    el('p', { class: 'alert-soft' }, '이유: ' + reasonText((ctx.sms.reasons || [])[0])),
    el('p', {}, '아래 [직접 쓰기로 이어가기]를 눌러 직접 기록해 주세요. 붙여 넣은 글을 보면서 쓰실 수 있어요.'),
    el('div', { class: 'card peek' }, text),
    el('button', {
      type: 'button', class: 'btn primary',
      onclick: () => { ctx.peekText = text; ctx.sms = null; location.hash = '#/write'; },
    }, '직접 쓰기로 이어가기'),
    el('a', { class: 'btn', href: '#/sms' }, '다시 붙여넣기'),
  );
}

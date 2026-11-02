/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 기록 고치기와 삭제 (S6의 항목 화면)
import { el } from './dom.js';
import { formatWon, formatDateKo } from './format.js';
import { makeAmountField } from './amountField.js';
import { costTypeField } from './costType.js'; // COST-TYPE-ENTRY
import { dbGet, dbGetAll } from '../storage/db.js';
import { periodKeyOf } from '../storage/dates.js';
import { updateTransaction } from '../storage/transactions.js';
import { softDeleteWithJar, findUsedEntry } from '../storage/jarUse.js'; // JAR-LINK-ENTRY
import { getJar, setJarStatsOff, isSurplus } from '../storage/jars.js';

const PAY_METHODS = [
  ['cash', '현금'], ['debit', '체크카드'], ['credit', '신용카드'],
  ['account', '계좌이체'], ['pay', '간편결제'], ['etc', '기타'],
];

// 받은 돈은 어떻게 받았는지만 고른다 (write.js의 INCOME_PAY_METHODS와 같다)
const INCOME_PAY_METHODS = [['account', '통장으로 받음'], ['cash', '현금'], ['etc', '기타']];

export async function editView(ctx, path, params) {
  const rec = await dbGet(ctx.db, 'transactions', params.id);
  if (!rec || rec.deletedAt) {
    return el('section', {},
      el('h1', {}, '기록을 찾지 못했어요'),
      el('a', { class: 'btn primary', href: '#/history' }, '내역으로'));
  }
  // 저금통 칸과 연결된 기록(칸에서 쓴 돈, 미리 떼어 둔 돈 칸에 저금한 돈)은 칸의 기록과 짝이라서 금액과 날짜는 고칠 수 없다 (어긋남 방지). JAR-LINK-ENTRY
  // 미리 떼어 둔 돈 칸에 저금한 돈은 분류도 고칠 수 없다 (D113).
  let linked = null;
  try { linked = rec.type === 'expense' ? await findUsedEntry(ctx.db, rec.id, true) : null; } catch (e) { console.error(e); }
  const deposit = !!(linked && linked.kind === 'moved');
  // 저금통 칸과 짝인 기록이면 그 칸을 통계에서 빼거나 다시 넣을 수 있다 (D140). 남은 돈 모음 칸은 뺄 수 없다.
  let statsJar = null;
  try {
    const jid = rec.type === 'expense' ? (rec.jarId || (linked && linked.jarId)) : null;   // 칸과 짝인 기록(옛 방식으로 저장된 칸에서 쓴 돈 포함)
    const j = jid ? await getJar(ctx.db, jid) : null;
    if (j && !isSurplus(j)) statsJar = j;
  } catch (e) { console.error(e); }
  // 마무리한 칸에 저금한 기록은 지우면 칸이 보이지 않는 채 마이너스가 되므로 지울 수 없다 (Q70)
  const lockedDeposit = !!(deposit && statsJar && statsJar.status === 'done');
  const startDay = ctx.settings.monthStartDay || 1;
  // 결산의 세부 내역 목록에서 왔으면(주소 끝 kind-종류-달) 고친 뒤와 [뒤로]에서 그 목록으로 돌아간다 (D139)
  const fromKind = /^kind-(fixed|variable|oneoff)-(\d{4}-\d{2})$/.exec(params.back || '');
  const kindBack = fromKind ? '#/settle/' + fromKind[2] + '/' + fromKind[1] : null;
  const backHref = kindBack || ('#/history/' + periodKeyOf(rec.date, startDay));

  const categories = (await dbGetAll(ctx.db, 'categories'))
    .filter((c) => c.kind === (rec.type === 'income' ? 'income' : 'expense') && (c.isActive || c.id === rec.categoryId))
    .sort((a, b) => a.order - b.order);

  const amountField = makeAmountField({ initial: rec.amount });
  const dateInput = el('input', { id: 'date', class: 'input', type: 'date', value: rec.date });
  const category = rec.type === 'transfer' ? null : el('select', { id: 'cat', class: 'input' },
    categories.map((c) => el('option', { value: c.id, selected: c.id === rec.categoryId }, c.name)));
  const income = rec.type === 'income';
  const pay = el('select', { id: 'pay', class: 'input' },
    (income ? INCOME_PAY_METHODS : PAY_METHODS).map(([value, label]) => el('option', { value, selected: rec.payMethod === value }, label)));
  if (linked) { amountField.input.disabled = true; dateInput.disabled = true; }   // JAR-LINK-ENTRY
  if (deposit && category) category.disabled = true;
  // 구분(고정비·변동비·일회성): 쓴 돈만, 저금통과 짝인 기록은 합계에 넣지 않으므로 뺀다. COST-TYPE-ENTRY
  // 분류를 바꾸면 직접 고르지 않은 경우에 한해 새 분류의 기본값을 따른다.
  const catDefault = () => {
    const c = category ? categories.find((x) => x.id === category.value) : null;
    return (c && c.costTypeDefault) || 'variable';
  };
  const showCost = rec.type === 'expense' && !linked && !rec.fromReserve && !rec.reserveDeposit;
  let costValue = rec.costType || catDefault();
  let costTouched = !!rec.costType && rec.costType !== (((categories.find((x) => x.id === rec.categoryId)) || {}).costTypeDefault || 'variable');   // 예전에 직접 고른 값은 분류를 바꿔도 지키지 않는다
  const costBox = showCost ? costTypeField({
    get: () => costValue,
    set: (v) => { costValue = v; costTouched = true; },
    getDefault: catDefault,
  }) : null;
  if (costBox && category) category.addEventListener('change', () => { if (!costTouched) costValue = catDefault(); costBox.refresh(); });
  const memo = el('input', { id: 'memo', class: 'input', type: 'text', maxlength: '60', autocomplete: 'off', value: rec.memo || '' });

  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const fail = (msg) => { alertBox.textContent = msg; alertBox.hidden = false; };

  const save = el('button', { type: 'button', class: 'btn primary' }, '저장');
  save.addEventListener('click', async () => {
    save.disabled = true; alertBox.hidden = true;
    try {
      const changes = {
        amount: linked ? rec.amount : amountField.amount, date: linked ? rec.date : dateInput.value,
        payMethod: pay.value, memo: memo.value.trim(),
      };
      if (category && !deposit) changes.categoryId = category.value;
      if (showCost) changes.costType = costValue;
      const next = await updateTransaction(ctx.db, rec.id, changes);
      location.hash = kindBack || ('#/history/' + periodKeyOf(next.date, startDay));
    } catch (e) {
      fail(e.userMessage || '저장하지 못했어요. 한 번 더 눌러 주세요.');
      save.disabled = false;
    }
  });

  // 삭제는 두 번 확인한다: [이 기록 삭제] -> "정말 삭제하시겠어요?" -> [삭제할게요]
  // 실수로 누르는 것을 막기 위해 안전한 [그만둘게요]를 위에, 큰 주된 버튼으로 둔다.
  const formBox = el('div', {});
  const confirmBox = el('div', { hidden: true });

  const del = el('button', { type: 'button', class: 'btn danger' }, '이 기록 삭제');
  del.addEventListener('click', () => {
    formBox.hidden = true;
    confirmBox.hidden = false;
    window.scrollTo(0, 0);
    stay.focus();
  });

  const stay = el('button', { type: 'button', class: 'btn primary' }, '그만둘게요');
  stay.addEventListener('click', () => {
    confirmBox.hidden = true;
    formBox.hidden = false;
    del.focus();
  });

  const reallyDelete = el('button', { type: 'button', class: 'btn danger' }, '삭제할게요');
  reallyDelete.addEventListener('click', async () => {
    reallyDelete.disabled = true;
    try {
      await softDeleteWithJar(ctx.db, rec.id);   // JAR-LINK-ENTRY: 칸의 사용 기록도 함께 지운다
      ctx.undo = { id: rec.id, text: formatDateKo(rec.date) + ' ' + formatWon(rec.amount) };
      location.hash = backHref;
    } catch (e) {
      confirmBox.hidden = true;
      formBox.hidden = false;
      fail('삭제하지 못했어요. 한 번 더 눌러 주세요.');
      reallyDelete.disabled = false;
    }
  });

  const statsBox = el('div', { class: 'card' });
  const paintStats = () => {
    const off = !!(statsJar && statsJar.statsOff);
    if (!off && statsJar.status !== 'done') {   // 쓰는 중인 칸은 뺄 수 없다: 단추 없이 안내만 한다
      statsBox.replaceChildren(
        el('p', { class: 'kicker' }, '"' + statsJar.name + '" 칸 · 결산 통계'),
        el('p', { class: 'note' }, '이 칸은 아직 쓰는 중이라 통계에서 뺄 수 없어요. 칸을 마무리한 뒤에 뺄 수 있어요.'));
      return;
    }
    const toggle = el('button', { type: 'button', class: 'btn' }, off ? '통계에 다시 넣기' : '이 칸을 통계에서 빼기');
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        statsJar = await setJarStatsOff(ctx.db, statsJar.id, !off);
        location.hash = backHref;
      } catch (e) {
        fail(e.userMessage || '바꾸지 못했어요. 한 번 더 눌러 주세요.');
        toggle.disabled = false;
      }
    });
    statsBox.replaceChildren(
      el('p', { class: 'kicker' }, '"' + statsJar.name + '" 칸 · 결산 통계'),
      el('p', { class: 'note' }, off
        ? '이 칸은 통계에서 빼 둔 상태예요. 이 칸의 저금·꺼내 쓴 기록은 결산의 "쓴 돈"과 "평소와 비교", 신호등에 들어가지 않아요.'
        : '연습으로 적은 기록처럼 결산에 넣고 싶지 않은 칸이면, 칸 전체를 통계에서 뺄 수 있어요. 기록과 칸의 돈은 그대로 있고, 언제든 다시 넣을 수 있어요.'),
      toggle);
  };
  if (statsJar) paintStats();

  const label = (rec.type === 'transfer' ? '이체' : (categories.find((c) => c.id === rec.categoryId) || {}).name || '')
    + ' ' + formatWon(rec.amount);
  confirmBox.append(
    el('h1', {}, '정말 삭제하시겠어요?'),
    el('div', { class: 'card' },
      el('p', { class: 'row-value' }, label),
      el('p', { class: 'meta' }, formatDateKo(rec.date) + (rec.memo ? ' · ' + rec.memo : ''))),
    stay,
    reallyDelete,
    el('p', { class: 'note' }, deposit ? '삭제해도 바로 되돌릴 수 있어요. 저금통 칸에 저금한 기록도 함께 지워져요.'
      : linked ? '삭제해도 바로 되돌릴 수 있어요. 저금통 칸의 모은 돈도 함께 원래대로 돌아와요.' : '삭제해도 바로 되돌릴 수 있어요.'),
  );

  formBox.append(
    el('h1', {}, '기록 고치기'),
    el('label', { for: 'amount', class: 'label' }, '금액 (원)'),
    amountField.input, amountField.reading,
    el('label', { for: 'date', class: 'label' }, '날짜'), dateInput,
    ...(deposit ? [el('p', { class: 'note' }, '미리 떼어 둔 돈 칸에 저금한 돈과 짝인 기록이라 금액, 날짜, 분류는 고칠 수 없어요. 바꾸려면 이 기록을 삭제하고 [저금통]에서 다시 저금해 주세요.')]
      : linked ? [el('p', { class: 'note' }, '저금통 칸에서 쓴 돈이라 금액과 날짜는 고칠 수 없어요. 바꾸려면 이 기록을 삭제하고 다시 기록해 주세요.')] : []),
    ...(category ? [el('label', { for: 'cat', class: 'label' }, income ? '어떤 돈인가요' : '어디에 쓰셨나요'), category] : []),
    ...(costBox ? [costBox] : []), // COST-TYPE-ENTRY (formBox.append는 빈 값을 "null" 글자로 바꾸므로 빈 값은 뺀다)
    el('label', { for: 'pay', class: 'label' }, income ? '어떻게 받으셨나요?' : '어떻게 쓰셨나요?'), pay,
    el('label', { for: 'memo', class: 'label' }, '메모'), memo,
    alertBox,
    save,
    el('a', { class: 'btn', href: backHref }, '뒤로'),
    ...(statsJar ? [el('hr', { class: 'sep' }), statsBox] : []),
    el('hr', { class: 'sep' }),
    ...(lockedDeposit
      ? [el('p', { class: 'note' }, '이미 마무리한 칸에 저금한 기록이라 지울 수 없어요. 지우면 마무리한 칸의 돈이 맞지 않게 돼요.')]
      : [del]),
  );

  return el('section', {}, formBox, confirmBox);
}

// 기록 고치기와 삭제 (S6의 항목 화면)
import { el } from './dom.js';
import { formatWon, formatDateKo } from './format.js';
import { makeAmountField } from './amountField.js';
import { dbGet, dbGetAll } from '../storage/db.js';
import { periodKeyOf } from '../storage/dates.js';
import { updateTransaction, softDeleteTransaction } from '../storage/transactions.js';

const PAY_METHODS = [
  ['cash', '현금'], ['debit', '체크카드'], ['credit', '신용카드'],
  ['account', '계좌로 보냄'], ['pay', '간편결제'], ['etc', '기타'],
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
  const startDay = ctx.settings.monthStartDay || 1;
  const backHref = '#/history/' + periodKeyOf(rec.date, startDay);

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
  const memo = el('input', { id: 'memo', class: 'input', type: 'text', maxlength: '60', autocomplete: 'off', value: rec.memo || '' });

  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const fail = (msg) => { alertBox.textContent = msg; alertBox.hidden = false; };

  const save = el('button', { type: 'button', class: 'btn primary' }, '저장');
  save.addEventListener('click', async () => {
    save.disabled = true; alertBox.hidden = true;
    try {
      const changes = {
        amount: amountField.amount, date: dateInput.value,
        payMethod: pay.value, memo: memo.value.trim(),
      };
      if (category) changes.categoryId = category.value;
      const next = await updateTransaction(ctx.db, rec.id, changes);
      location.hash = '#/history/' + periodKeyOf(next.date, startDay);
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
      await softDeleteTransaction(ctx.db, rec.id);
      ctx.undo = { id: rec.id, text: formatDateKo(rec.date) + ' ' + formatWon(rec.amount) };
      location.hash = backHref;
    } catch (e) {
      confirmBox.hidden = true;
      formBox.hidden = false;
      fail('삭제하지 못했어요. 한 번 더 눌러 주세요.');
      reallyDelete.disabled = false;
    }
  });

  const label = (rec.type === 'transfer' ? '이체' : (categories.find((c) => c.id === rec.categoryId) || {}).name || '')
    + ' ' + formatWon(rec.amount);
  confirmBox.append(
    el('h1', {}, '정말 삭제하시겠어요?'),
    el('div', { class: 'card' },
      el('p', { class: 'row-value' }, label),
      el('p', { class: 'meta' }, formatDateKo(rec.date) + (rec.memo ? ' · ' + rec.memo : ''))),
    stay,
    reallyDelete,
    el('p', { class: 'note' }, '삭제해도 바로 되돌릴 수 있어요.'),
  );

  formBox.append(
    el('h1', {}, '기록 고치기'),
    el('label', { for: 'amount', class: 'label' }, '금액 (원)'),
    amountField.input, amountField.reading,
    el('label', { for: 'date', class: 'label' }, '날짜'), dateInput,
    ...(category ? [el('label', { for: 'cat', class: 'label' }, income ? '어떤 돈인가요' : '어디에 쓰셨나요'), category] : []),
    el('label', { for: 'pay', class: 'label' }, income ? '어떻게 받으셨나요?' : '어떻게 내셨나요?'), pay,
    el('label', { for: 'memo', class: 'label' }, '메모'), memo,
    alertBox,
    save,
    el('a', { class: 'btn', href: backHref }, '뒤로'),
    el('hr', { class: 'sep' }),
    del,
  );

  return el('section', {}, formBox, confirmBox);
}

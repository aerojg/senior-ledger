/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 금액 입력칸: 숫자만 받고, 쉼표를 붙이고, 한글로 읽어 준다 (Q26)
// 직접 쓰기(S4)와 기록 고치기(S6)가 함께 쓴다.
import { el } from './dom.js';
import { onlyDigits, withCommas, koreanAmount } from './format.js';

export function makeAmountField({ id = 'amount', initial = 0, onChange = () => {} } = {}) {
  const input = el('input', {
    id, class: 'input big', type: 'text', inputmode: 'numeric',
    autocomplete: 'off', 'aria-describedby': id + '-reading', placeholder: '0',
    value: initial ? withCommas(initial) : '',
  });
  const reading = el('p', { id: id + '-reading', class: 'reading', 'aria-live': 'polite' });
  const field = { input, reading, amount: initial || 0 };

  function refresh() {
    reading.textContent = field.amount ? koreanAmount(field.amount) : '';
  }
  input.addEventListener('input', () => {
    const digits = onlyDigits(input.value).replace(/^0+/, '').slice(0, 10);
    field.amount = digits ? Number(digits) : 0;
    input.value = withCommas(digits);
    refresh();
    onChange(field.amount);
  });
  refresh();
  return field;
}

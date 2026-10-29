/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 아직 만들지 않은 화면에 보이는 안내 (다음 할 일 한 가지만 안내한다, U9)
import { el } from './dom.js';

export function placeholderView(title, note) {
  return el('section', {},
    el('h1', {}, title),
    el('div', { class: 'card' }, el('p', {}, note || '아직 준비 중이에요.')),
    el('a', { class: 'btn primary', href: '#/home' }, '홈으로'),
  );
}

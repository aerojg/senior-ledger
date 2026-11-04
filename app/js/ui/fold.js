/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 펴기·접기 단추의 모양과 문구를 한곳에서 정한다 (2026-11-04, 모든 화면 공통).
// 규칙: 단추 글자는 늘 "{펴고 접는 대상} 펴기 ▼" / "{펴고 접는 대상} 접기 ▲" 이고, 모양은 같은 보통 단추(.btn.fold-btn)다.
// 카드 제목줄에서 펴고 접는 경우(settle.js의 foldCard)도 글자는 같은 "펴기 ▼" / "접기 ▲"이다 (css .fold > summary::after).
// 새로 펴고 접는 곳을 만들 때는 이 파일의 함수만 쓴다. 다른 글자("보기", "더보기", "닫기", "펼치기")는 쓰지 않는다.
import { el } from './dom.js';

export const foldText = (name, open) => name + (open ? ' 접기 ▲' : ' 펴기 ▼');
const btnText = (open) => (open ? '접기 ▲' : '펴기 ▼');

// 한 줄: 왼쪽에 대상 이름(" "), 맨 오른쪽에 단추([펴기 ▼] / [접기 ▲]). 이름과 동작이 이어 붙어 애매하게 읽히지 않게 갈라 놓는다.
// 화면 읽기 프로그램에는 "{대상} 펴기" 처럼 이름을 함께 읽어 준다.
export function foldButton(name, { open = false, onToggle = null, controls = null } = {}) {
  const btn = el('button', { type: 'button', class: 'btn fold-btn', 'aria-expanded': String(!!open), 'aria-label': foldText(name, !!open).replace(/ [▼▲]$/, '') }, btnText(!!open));
  if (controls) btn.setAttribute('aria-controls', controls);
  if (onToggle) btn.addEventListener('click', onToggle);
  return el('div', { class: 'fold-row' }, el('span', { class: 'fold-name' }, name), btn);
}

// 단추 줄 + 숨겨진 내용 상자 한 쌍. [줄, 상자]를 돌려주므로 화면에 차례로 붙이면 된다.
export function foldBox(name, nodes, { open = false, id = null } = {}) {
  const box = el('div', { hidden: open ? null : 'hidden', id }, ...nodes);
  const row = foldButton(name, { open, controls: id });
  const btn = row.querySelector('button');
  btn.addEventListener('click', () => {
    const nowOpen = box.hasAttribute('hidden');
    box.toggleAttribute('hidden', !nowOpen);
    btn.textContent = btnText(nowOpen);
    btn.setAttribute('aria-expanded', String(nowOpen));
    btn.setAttribute('aria-label', foldText(name, nowOpen).replace(/ [▼▲]$/, ''));
  });
  return [row, box];
}

// 단추 상태를 화면을 다시 그릴 때마다 바꿔야 하는 곳(분류 "나머지 N개")용. row.setState(이름, 펴짐 여부)로 글자를 고친다.
export function foldRow(onToggle) {
  const btn = el('button', { type: 'button', class: 'btn fold-btn' });
  const nameEl = el('span', { class: 'fold-name' });
  const row = el('div', { class: 'fold-row' }, nameEl, btn);
  row.btn = btn;
  row.setState = (name, open) => {
    nameEl.textContent = name;
    btn.textContent = btnText(open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', foldText(name, open).replace(/ [▼▲]$/, ''));
  };
  btn.addEventListener('click', onToggle);
  return row;
}

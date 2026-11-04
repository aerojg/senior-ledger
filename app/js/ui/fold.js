/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 펴기·접기 단추의 모양과 문구를 한곳에서 정한다 (2026-11-04, 모든 화면 공통).
// 규칙: 단추 글자는 늘 "{펴고 접는 대상} 펴기 ▼" / "{펴고 접는 대상} 접기 ▲" 이고, 모양은 같은 보통 단추(.btn.fold-btn)다.
// 카드 제목줄에서 펴고 접는 경우(settle.js의 foldCard)도 글자는 같은 "펴기 ▼" / "접기 ▲"이다 (css .fold > summary::after).
// 새로 펴고 접는 곳을 만들 때는 이 파일의 함수만 쓴다. 다른 글자("보기", "더보기", "닫기", "펼치기")는 쓰지 않는다.
import { el } from './dom.js';

export const foldText = (name, open) => name + (open ? ' 접기 ▲' : ' 펴기 ▼');

// 단추 하나. 눌렀을 때 하는 일은 onToggle이 정한다. 화면을 다시 그리는 곳은 그릴 때마다 foldButton을 새로 만들면 된다.
export function foldButton(name, { open = false, onToggle = null, controls = null } = {}) {
  const btn = el('button', { type: 'button', class: 'btn fold-btn', 'aria-expanded': String(!!open) }, foldText(name, !!open));
  if (controls) btn.setAttribute('aria-controls', controls);
  if (onToggle) btn.addEventListener('click', onToggle);
  return btn;
}

// 단추 + 숨겨진 내용 상자 한 쌍. [단추, 상자]를 돌려주므로 화면에 차례로 붙이면 된다.
export function foldBox(name, nodes, { open = false, id = null } = {}) {
  const box = el('div', { hidden: open ? null : 'hidden', id }, ...nodes);
  const btn = foldButton(name, { open, controls: id });
  btn.addEventListener('click', () => {
    const nowOpen = box.hasAttribute('hidden');
    box.toggleAttribute('hidden', !nowOpen);
    btn.textContent = foldText(name, nowOpen);
    btn.setAttribute('aria-expanded', String(nowOpen));
  });
  return [btn, box];
}

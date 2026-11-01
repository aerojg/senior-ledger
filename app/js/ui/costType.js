/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 구분(고정비·변동비·일회성) 고르기. 기록 확인 화면(직접 쓰기, 문자 붙여넣기)과 기록 고치기가 함께 쓴다.
// 평소에는 분류에 정해진 구분을 그대로 쓰고, 다르면 [바꾸기]로 직접 고른다. 단계가 늘지 않는다(D123).
import { el } from './dom.js';

export const COST_CHOICES = [
  ['fixed', '고정비', '매달 나가는 돈', '달마다 거의 같은 금액이 정해진 날 나가요. 예: 통신비, 보험료, 관리비'],
  ['variable', '변동비', '그때그때 쓰는 돈', '달마다 쓰는 양이 달라지고 내가 조절할 수 있어요. 예: 식비, 교통비, 병원·약'],
  ['oneoff', '일회성', '한 번 크게 쓰는 돈', '자주 있지 않고 한 번에 큰 돈이 나가요. 예: 경조사비, 큰 수술비, 가전 구입'],
];

export function costName(value) {
  const c = COST_CHOICES.find((x) => x[0] === value);
  return c ? c[1] + ' (' + c[2] + ')' : '';
}

// 고정비·변동비·일회성의 뜻과 처음부터 있는 분류가 어디에 속하는지. 새 분류 만들기 화면도 이것을 쓴다.
export function costHelpCard() {
  const kind = (title, meaning, items) => el('div', { class: 'row stack' },
    el('p', { class: 'kicker' }, title), el('p', {}, meaning), el('p', { class: 'meta' }, '처음부터 있는 분류: ' + items));
  return el('div', { class: 'card' },
    el('h2', { class: 'card-title' }, '구분 고르는 방법'),
    kind('매달 나가는 돈 (고정비)', '달마다 거의 같은 금액이 정해진 날 나가는 돈이에요. 줄이려면 해지나 변경을 해야 해요.', '주거·공과금, 통신, 보험, 구독·정기결제, 모임회비'),
    kind('그때그때 쓰는 돈 (변동비)', '달마다 쓰는 양이 달라지고, 내가 조절할 수 있는 돈이에요.', '식비, 생활용품, 건강·병원·약, 교통, 차량유지비, 여가·여행·취미, 가족·손주, 기타'),
    kind('한 번 크게 쓰는 돈 (일회성)', '자주 있지 않고 한 번에 큰 금액이 나가는 일이에요. 평소 쓰는 돈을 비교할 때에서 빠져요.', '경조사'),
    el('p', { class: 'note' }, '같은 분류라도 이번 돈이 다를 수 있어요. 예를 들어 병원비 중 정기 진료와 약은 "그때그때 쓰는 돈"이고, 큰 수술비는 "한 번 크게 쓰는 돈"이에요. 헷갈리면 "그때그때 쓰는 돈"이 무난해요.'));
}

// 확인 화면에 붙이는 "구분" 칸.
// get(): 지금 구분, set(값): 사용자가 고른 구분 저장, getDefault(): 분류에 정해진 구분
// 돌려주는 상자에는 refresh()가 있어서, 분류가 바뀌어 기본값이 달라졌을 때 다시 그릴 수 있다.
export function costTypeField({ get, set, getDefault }) {
  const box = el('div', { class: 'card' });
  let open = false;
  let help = false;

  function paint() {
    const now = get();
    const def = getDefault();
    if (!open) {
      box.replaceChildren(el('div', { class: 'row' },
        el('div', {},
          el('p', { class: 'kicker' }, '구분'),
          el('p', { class: 'row-value' }, costName(now)),
          el('p', { class: 'meta' }, now === def ? '분류에 정해진 대로예요. 다르면 바꿔 주세요.' : '직접 바꿨어요.')),
        el('button', { type: 'button', class: 'link-btn', 'aria-expanded': 'false', onclick: () => { open = true; paint(); } }, '바꾸기')));
      return;
    }
    const choices = COST_CHOICES.map(([value, short, plain, example]) => {
      const on = now === value;
      return el('div', { class: 'row stack' },
        el('button', {
          type: 'button', class: 'btn seg' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
          onclick: () => { set(value); open = false; help = false; paint(); },
        }, (on ? '✓ ' : '') + short + ' (' + plain + ')'),
        el('p', { class: 'meta' }, example));
    });
    const helpBtn = el('button', { type: 'button', class: 'btn sub', 'aria-expanded': help ? 'true' : 'false', onclick: () => { help = !help; paint(); } },
      help ? '구분 고르는 방법 닫기' : '구분 고르는 방법');
    // replaceChildren은 null을 "null" 글자로 넣으므로 빈 칸은 걸러서 넘긴다
    box.replaceChildren(...[
      el('p', { class: 'label' }, '이 돈은 어떤 돈인가요?'),
      ...choices,
      helpBtn,
      help ? costHelpCard() : null,
      el('button', { type: 'button', class: 'btn', onclick: () => { open = false; help = false; paint(); } }, '그대로 둘게요'),
    ].filter(Boolean));
  }
  paint();
  box.refresh = paint;
  return box;
}

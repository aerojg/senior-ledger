/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 설정 화면 (S11 아래): 글씨 크기, 코치 말투, 한 달 시작일, 한 줄 응원, 소리, 움직임
// 바꾸면 바로 저장하고 화면에 반영한다. 저장 단추는 따로 없다.
import { el } from './dom.js';
import { dbGet, dbPut } from '../storage/db.js';
import { makeDefaultSettings } from '../storage/defaults.js';
import { applyFontScale } from './appearance.js';
import { playCoin } from './effects.js';

export const FONT_CHOICES = [['기본', 1], ['크게', 1.2], ['아주 크게', 1.4]];
const COACH_CHOICES = [
  ['neighbor', '다정한 이웃형', '"여유 있게 보내셨어요. 잘하셨어요."'],
  ['captain', '유쾌한 반장님형', '"여유 만점입니다! 박수 짝짝!"'],
  ['secretary', '담담한 비서형', '"수입 대비 지출은 여유 있는 수준입니다."'],
];

export async function saveSetting(ctx, patch) {
  const current = (await dbGet(ctx.db, 'settings', 'main')) || makeDefaultSettings();
  const next = { ...current, ...patch, key: 'main' };
  await dbPut(ctx.db, 'settings', next);
  ctx.settings = next;
  applyFontScale(next.fontScale);
}

// 눌린 쪽에는 ✓를 붙여 색만으로 구분하지 않는다 (U5)
export function choiceButton(label, isOn, onPick) {
  const b = el('button', { type: 'button', class: 'btn seg' + (isOn ? ' on' : ''), 'aria-pressed': isOn ? 'true' : 'false' },
    (isOn ? '✓ ' : '') + label);
  b.addEventListener('click', onPick);
  return b;
}

function monthStartText(day) {
  return day === 1
    ? '매월 1일부터 그 달 마지막 날까지를 한 달로 세요.'
    : '매월 ' + day + '일부터 다음 달 ' + (day - 1) + '일까지를 한 달로 세요.';
}

export async function settingsView(ctx) {
  const s = ctx.settings || makeDefaultSettings();
  const box = el('section', {});
  let failed = false;

  const apply = async (patch) => {
    try { await saveSetting(ctx, patch); failed = false; }
    catch (e) { console.error(e); failed = true; }
    paint();
  };

  function fontCard() {
    const now = Number(ctx.settings.fontScale) || 1;
    return el('div', { class: 'card' },
      el('p', { class: 'kicker' }, '글씨 크기'),
      el('div', { class: 'grid3' }, FONT_CHOICES.map(([label, v]) =>
        choiceButton(label, Math.abs(now - v) < 0.01, () => apply({ fontScale: v })))),
      el('p', { class: 'note' }, '읽기 편한 크기를 골라 주세요. 고르면 앱 전체 글씨가 바로 바뀌어요.'));
  }

  function coachCard() {
    const now = ctx.settings.coachStyle || 'neighbor';
    return el('div', { class: 'card' },
      el('p', { class: 'kicker' }, '말투'),
      COACH_CHOICES.map(([id, label, sample]) => el('div', { class: 'kv-item' },
        choiceButton(label, now === id, () => apply({ coachStyle: id })),
        el('p', { class: 'meta' }, sample))),
      el('p', { class: 'note' }, '한 달 결산과 기록 직후 응원 글의 말투예요.'));
  }

  function startDayCard() {
    const day = Math.min(28, Math.max(1, Number(ctx.settings.monthStartDay) || 1));
    const minus = el('button', { type: 'button', class: 'btn', 'aria-label': '하루 앞으로' }, '−');
    const plus = el('button', { type: 'button', class: 'btn', 'aria-label': '하루 뒤로' }, '+');
    minus.disabled = day <= 1;
    plus.disabled = day >= 28;
    minus.addEventListener('click', () => apply({ monthStartDay: day - 1 }));
    plus.addEventListener('click', () => apply({ monthStartDay: day + 1 }));
    return el('div', { class: 'card' },
      el('p', { class: 'kicker' }, '한 달 시작일'),
      el('div', { class: 'stepper' }, minus, el('p', { class: 'row-value stepper-value' }, day + '일'), plus),
      el('p', { class: 'note' }, monthStartText(day) + ' 연금이나 월급을 받는 날부터 보고 싶을 때 바꾸세요.'));
  }

  function onOffCard(title, key, explain) {
    // 한 줄 응원은 값이 없으면 켜진 것으로 본다(cheer.js와 같은 기준)
    const on = key === 'showCheer' ? ctx.settings[key] !== false : !!ctx.settings[key];
    return el('div', { class: 'card' },
      el('p', { class: 'kicker' }, title),
      el('div', { class: 'grid2 tight-grid' },
        choiceButton('켜기', on, async () => {
          await apply({ [key]: true });
          if (key === 'soundOn') playCoin(ctx.settings); // 켜는 순간 어떤 소리인지 한 번 들려 준다
        }),
        choiceButton('끄기', !on, () => apply({ [key]: false }))),
      el('p', { class: 'note' }, explain));
  }

  function paint() {
    box.replaceChildren(...[
      el('h1', {}, '설정'),
      failed ? el('div', { class: 'alert', role: 'alert' }, '바꾸지 못했어요. 한 번 더 눌러 주세요.') : null,
      fontCard(),
      coachCard(),
      startDayCard(),
      onOffCard('한 줄 응원', 'showCheer', '기록을 마치면 보이는 짧은 응원 글이에요. 하루 두 번까지만 보여 드려요. 필수 지출에는 칭찬 없이 담담한 말만 나와요.'),
      onOffCard('소리', 'soundOn', '기록을 마치면 짧은 동전 소리가 나요. 처음에는 꺼져 있어요. 켜면 소리가 한 번 들려요.'),
      onOffCard('움직임', 'animationOn', '기록을 마치면 ✓ 표시와 도장이 살짝 움직여요. 처음에는 꺼져 있어요. 폰에서 "움직임 줄이기"를 켜 두셨다면 이 설정과 관계없이 움직이지 않아요.'),
      el('a', { class: 'btn', href: '#/more' }, '더보기로'),
    ].filter(Boolean));
  }

  paint();
  return box;
}

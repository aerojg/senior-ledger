// 설정 화면 (S11 아래): 글씨 크기, 코치 말투, 한 달 시작일, 소리·움직임·한 줄 응원
// 바꾸면 바로 저장하고 화면에 반영한다. 저장 단추는 따로 없다.
import { el } from './dom.js';
import { dbGet, dbPut } from '../storage/db.js';
import { makeDefaultSettings } from '../storage/defaults.js';
import { applyFontScale } from './appearance.js';

const SHOW_FUTURE_SETTINGS = false;
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
      el('p', { class: 'note' }, '한 달 결산에서 들려 드리는 말의 말투예요.'));
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
    const on = !!ctx.settings[key];
    return el('div', { class: 'card' },
      el('p', { class: 'kicker' }, title),
      el('div', { class: 'grid2 tight-grid' },
        choiceButton('켜기', on, () => apply({ [key]: true })),
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
      // 소리·움직임·한 줄 응원은 그 기능이 생길 때까지 화면에서 숨긴다(값은 설정에 그대로 보관된다).
      // 기능이 생기면 SHOW_FUTURE_SETTINGS를 true로 바꾸고 "준비 중" 글을 지운다.
      ...(SHOW_FUTURE_SETTINGS ? [
      onOffCard('소리', 'soundOn', '처음에는 꺼져 있어요. 소리 기능은 아직 준비 중이에요. 지금 골라 두시면 나중에 그대로 적용돼요.'),
      onOffCard('움직임', 'animationOn', '처음에는 꺼져 있어요. 움직이는 효과는 아직 준비 중이에요. 지금 골라 두시면 나중에 그대로 적용돼요.'),
      onOffCard('한 줄 응원', 'showCheer', '기록을 마치면 보이는 짧은 응원 글이에요. 한 줄 응원 글은 아직 준비 중이에요.')
      ] : []),
      el('a', { class: 'btn', href: '#/more' }, '더보기로'),
    ].filter(Boolean));
  }

  paint();
  return box;
}

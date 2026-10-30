/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// S14 오늘은 여기까지 (D62, 2026-10-30 변경): 저장됐다는 안내와 필요하면 백업 권유만 보인다.
// 웹앱은 스스로 닫을 수 없어서 [앱 닫기] 단추와 닫는 방법 안내는 두지 않는다(눌러도 닫히지 않아 고장처럼 보임).
// 닫지 않아도 기록은 안전하다는 말로 안심시킨다. 폰의 홈 단추 같은 말은 앱 아래의 홈 메뉴와 헷갈려서 쓰지 않는다.
import { el } from './dom.js';
import { computeReminder } from '../storage/backup.js';

function reminderText(r) {
  if (r.reason === 'never') return '아직 내 기록을 파일로 저장해 두지 않으셨어요.';
  if (r.reason === 'new') return '마지막으로 저장한 뒤 새로 쓴 기록이 ' + r.count + '건 쌓였어요.';
  return '마지막으로 저장한 지 ' + r.days + '일이 지났어요.';
}

export async function exitView(ctx) {
  let reminder = null;
  try { reminder = await computeReminder(ctx.db); } catch (e) { console.error(e); }

  return el('section', {},
    el('h1', {}, '오늘도 수고하셨어요'),
    el('p', { class: 'note' }, '기록은 입력할 때마다 이 휴대폰에 저장돼 있어요.'),
    el('p', { class: 'note' }, '앱을 따로 닫지 않으셔도 괜찮아요. 화면을 꺼도 기록은 그대로예요.'),
    reminder ? el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, '기록을 파일로 저장해 둘까요?'),
      el('p', { class: 'kv-value' }, reminderText(reminder)),
      el('p', { class: 'note warn' }, '휴대폰을 바꾸거나 고장 났을 때를 대비해 파일로 저장해 두면 안심이에요.'),
      el('a', { class: 'btn primary', href: '#/backup' }, '내 기록 저장하기')) : null,
    el('a', { class: reminder ? 'btn' : 'btn primary', href: '#/home' }, '돌아가기'));
}

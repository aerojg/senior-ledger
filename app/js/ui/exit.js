// S14 앱 끝내기 (D62): 저장됐다는 안내, 필요하면 백업 권유, 닫는 방법
// 웹앱은 스스로 완전히 종료할 수 없다. [앱 닫기]를 누르면 창 닫기를 한 번 시도하고,
// 닫히지 않으면 폰에서 직접 닫는 방법을 알려 준다.
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

  const help = el('div', { class: 'card', hidden: true, role: 'status' },
    el('h2', { class: 'card-title' }, '이렇게 닫아 주세요'),
    el('p', { class: 'kv-value' }, '이 앱은 스스로 닫을 수 없어요. 폰의 홈 단추를 누르거나, 폰 아래에서 위로 쓸어 올리면 앱이 닫혀요. 쓰신 기록은 그대로 저장돼 있어요.'));

  const closeBtn = el('button', { type: 'button', class: reminder ? 'btn' : 'btn primary' }, '앱 닫기');   // 저장 권유가 있으면 그쪽을 주된 단추로 둔다
  closeBtn.addEventListener('click', () => {
    try { window.close(); } catch (e) { /* 닫을 수 없는 창이면 아래 안내를 보인다 */ }
    setTimeout(() => { help.hidden = false; try { help.scrollIntoView({ block: 'center' }); } catch (e) { /* 건너뜀 */ } }, 400);
  });

  return el('section', {},
    el('h1', {}, '오늘도 수고하셨어요'),
    el('p', { class: 'note' }, '기록은 입력할 때마다 이 휴대폰에 저장돼 있어요.'),
    reminder ? el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, '기록을 파일로 저장해 둘까요?'),
      el('p', { class: 'kv-value' }, reminderText(reminder)),
      el('p', { class: 'note warn' }, '휴대폰을 바꾸거나 고장 났을 때를 대비해 파일로 저장해 두면 안심이에요.'),
      el('a', { class: 'btn primary', href: '#/backup' }, '내 기록 저장하기')) : null,
    closeBtn,
    help,
    el('a', { class: 'btn', href: '#/home' }, '돌아가기'));
}

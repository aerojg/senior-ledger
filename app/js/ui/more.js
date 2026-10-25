// S11 더보기 (화면흐름 v1.2)
// 6-A에서는 [내 기록 저장·불러오기]만 있다. 글씨 크기·코치 성격 같은 설정은 6-B에서 이 목록에 더한다.
import { el } from './dom.js';

export async function moreView() {
  return el('section', {},
    el('h1', {}, '더보기'),
    el('a', { class: 'item', href: '#/backup' },
      el('div', { class: 'item-main' },
        el('p', { class: 'item-title' }, '내 기록 저장·불러오기'),
        el('p', { class: 'note' }, '휴대폰을 바꾸기 전에 꼭 저장해 두세요'))),
    el('a', { class: 'item', href: '#/intro' },
      el('div', { class: 'item-main' },
        el('p', { class: 'item-title' }, '앱 소개 다시 보기'),
        el('p', { class: 'note' }, '아래 메뉴 4개가 무엇인지 다시 볼 수 있어요'))),
    el('p', { class: 'note' }, '글씨 크기, 코치 성격 같은 설정은 곧 이곳에 더해져요.'),
  );
}

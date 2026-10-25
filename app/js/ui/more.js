// S11 더보기 (화면흐름 v1.2)
// 6-A에서는 [내 기록 저장·불러오기]만 있다. 글씨 크기·코치 성격 같은 설정은 6-B에서 이 목록에 더한다.
import { el } from './dom.js';
import { dbGetAll } from '../storage/db.js';

export async function moreView(ctx) {
  if (ctx) ctx.catBack = null;
  let hidden = 0;
  try { hidden = (await dbGetAll(ctx.db, 'categories')).filter((c) => c.isActive === false).length; } catch (e) { console.error(e); }
  return el('section', {},
    el('h1', {}, '더보기'),
    el('a', { class: 'item', href: '#/settings' },
      el('div', { class: 'item-main' },
        el('p', { class: 'item-title' }, '설정'),
        el('p', { class: 'note' }, '글씨 크기, 말투, 한 달 시작일 등을 바꿔요'))),
    el('a', { class: 'item', href: '#/categories' },
      el('div', { class: 'item-main' },
        el('p', { class: 'item-title' }, '분류 보기·숨기기'),
        el('p', { class: 'note' }, '쓰지 않는 분류를 숨겨서 화면을 간단하게 해요'),
        hidden > 0 ? el('p', { class: 'meta' }, '− 지금 숨긴 분류 ' + hidden + '개') : null)),
    el('a', { class: 'item', href: '#/backup' },
      el('div', { class: 'item-main' },
        el('p', { class: 'item-title' }, '내 기록 저장·불러오기'),
        el('p', { class: 'note' }, '휴대폰을 바꾸기 전에 꼭 저장해 두세요'))),
    el('a', { class: 'item', href: '#/about' },
      el('div', { class: 'item-main' },
        el('p', { class: 'item-title' }, '앱 정보·개인정보·사용 방법'),
        el('p', { class: 'note' }, '내 기록이 어디에 저장되는지 알려 드려요'))),
    el('a', { class: 'item', href: '#/intro' },
      el('div', { class: 'item-main' },
        el('p', { class: 'item-title' }, '앱 소개 다시 보기'),
        el('p', { class: 'note' }, '아래 메뉴 4개가 무엇인지 다시 볼 수 있어요'))),
    el('a', { class: 'btn', href: '#/exit' }, '앱 끝내기'),
  );
}

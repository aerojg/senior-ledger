// S0 처음 안내: 앱 이름과 아래 메뉴 4개를 쉽게 소개한다. 처음 켰을 때 한 번 나오고, 더보기에서 다시 볼 수 있다.
import { el } from './dom.js';
import { dbGet, dbPut } from '../storage/db.js';

const SEEN_KEY = 'introSeenAt';

export async function introSeen(db) {
  const m = await dbGet(db, 'meta', SEEN_KEY);
  return !!(m && m.value);
}

async function markSeen(db) {
  await dbPut(db, 'meta', { key: SEEN_KEY, value: new Date().toISOString() });
}

function menuRow(name, text) {
  return el('div', { class: 'kv-item' },
    el('p', { class: 'kicker' }, name),
    el('p', { class: 'kv-value' }, text));
}

export async function introView(ctx) {
  const go = el('button', {
    class: 'btn primary', type: 'button',
    onclick: async () => {
      try { await markSeen(ctx.db); } catch (e) { console.error(e); }
      location.hash = '#/home';
    },
  }, '홈으로 가기');
  return el('section', {},
    el('h1', {}, '가계부자'),
    el('p', { class: 'note' }, '쓴 돈을 쉽게 적고, 한 달을 돌아보는 가계부예요. 로그인 없이 무료로 쓰고, 기록은 이 휴대폰 안에만 있어요.'),
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, '아래 메뉴 4개'),
      menuRow('홈', '쓴 돈을 적고, 적은 기록(내역)을 봐요'),
      menuRow('결산', '한 달 동안 어디에 얼마 썼는지 정리해 봐요'),
      menuRow('저금통', '모으는 돈을 챙겨요'),
      menuRow('더보기', '내 기록을 파일로 저장해 두는 곳이에요')),
    go);
}

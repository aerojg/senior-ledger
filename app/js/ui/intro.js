// S0 처음 안내 (4장, 언제든 건너뛰기 가능). 처음 켰을 때 한 번 나오고, 더보기에서 다시 볼 수 있다.
// 1장 앱과 메뉴 소개 / 2장 내 기록 안내 / 3장 글씨 크기 고르기 / 4장 홈 화면 아이콘 안내 + 홈으로 가기
import { el } from './dom.js';
import { dbGet, dbPut } from '../storage/db.js';
import { FONT_CHOICES, saveSetting, choiceButton } from './settings.js';

const SEEN_KEY = 'introSeenAt';
const LAST = 4;

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
  const box = el('section', {});
  let step = 1;

  async function finish() {
    try { await markSeen(ctx.db); } catch (e) { console.error(e); }
    location.hash = '#/home';
  }

  const nextBtn = () => el('button', { type: 'button', class: 'btn primary', onclick: () => { step += 1; paint(); } }, '다음');
  const prevBtn = () => el('button', { type: 'button', class: 'btn', onclick: () => { step -= 1; paint(); } }, '이전');
  const skipBtn = () => el('button', { type: 'button', class: 'btn link-btn', onclick: finish }, '건너뛰기');

  function stepLabel() {
    return el('p', { class: 'meta' }, step + ' / ' + LAST);
  }

  function pageOne() {
    return [
      el('h1', {}, '가계부자'),
      stepLabel(),
      el('p', { class: 'note' }, '쓴 돈을 쉽게 적고, 한 달부터 1년까지 돌아보는 가계부예요. 로그인 없이 무료로 쓸 수 있어요.'),
      el('div', { class: 'card' },
        el('h2', { class: 'card-title' }, '아래 메뉴 4개'),
        menuRow('홈', '쓴 돈을 적고, 적은 기록(내역)을 봐요'),
        menuRow('결산', '한 달, 분기, 반기, 1년 단위로 어디에 얼마 썼는지 정리해 봐요'),
        menuRow('저금통', '모으는 돈을 챙겨요'),
        menuRow('더보기', '내 기록을 파일로 저장해 두는 곳이에요')),
      nextBtn(), skipBtn(),
    ];
  }

  function pageTwo() {
    return [
      el('h1', {}, '내 기록은 이 휴대폰 안에'),
      stepLabel(),
      el('div', { class: 'card' },
        menuRow('저장하는 곳', '기록은 이 휴대폰 안에만 저장돼요.'),
        menuRow('휴대폰을 바꾸기 전에', '더보기에서 "내 기록 저장하기"로 파일을 만들어 두세요. 새 휴대폰에서 다시 불러올 수 있어요.'),
        menuRow('항상 같은 앱으로', '기록은 지금 쓰는 앱에만 저장돼요. 크롬과 삼성 인터넷은 서로의 기록을 볼 수 없으니 항상 같은 앱으로 열어 주세요.')),
      nextBtn(), prevBtn(), skipBtn(),
    ];
  }

  function pageThree() {
    const now = Number(ctx.settings.fontScale) || 1;
    return [
      el('h1', {}, '글씨 크기'),
      stepLabel(),
      el('div', { class: 'card' },
        el('div', { class: 'grid3' }, FONT_CHOICES.map(([label, v]) =>
          choiceButton(label, Math.abs(now - v) < 0.01, async () => {
            try { await saveSetting(ctx, { fontScale: v }); } catch (e) { console.error(e); }
            paint();
          }))),
        el('div', { class: 'note' }, '이 글씨가 읽기 편한가요? 편한 크기를 눌러 주세요. 나중에 더보기의 설정에서 바꿀 수 있어요.')),
      nextBtn(), prevBtn(), skipBtn(),
    ];
  }

  function pageFour() {
    return [
      el('h1', {}, '홈 화면에 아이콘 만들기'),
      stepLabel(),
      el('div', { class: 'card' },
        menuRow('왜 만드나요?', '앞으로는 홈 화면의 아이콘으로 열어 주세요. 매번 주소를 찾지 않아도 돼요.'),
        menuRow('크롬 (권장)', '오른쪽 위의 점 세 개(⋮)를 누르고 "설치 및 바로가기 만들기"를 눌러요.'),
        menuRow('다른 인터넷 앱', '메뉴에서 "홈 화면에 추가"나 비슷한 이름을 찾아보세요. 어려우면 크롬에서 해 보세요.')),
      el('p', { class: 'note' }, '지금 만들지 않아도 괜찮아요. 나중에 더보기의 "앱 소개 다시 보기"에서 다시 볼 수 있어요.'),
      el('button', { type: 'button', class: 'btn primary', onclick: finish }, '홈으로 가기'),
      prevBtn(),
    ];
  }

  function paint() {
    const pages = [null, pageOne, pageTwo, pageThree, pageFour];
    box.replaceChildren(...pages[step]());
    window.scrollTo(0, 0);
  }

  paint();
  return box;
}

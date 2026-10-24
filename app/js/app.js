// 앱의 시작점: 저장소를 열고, 주소(#/...)에 맞는 화면을 그린다
import { initDb, dbGet } from './storage/db.js';
import { el } from './ui/dom.js';
import { homeView } from './ui/home.js';
import { placeholderView } from './ui/placeholder.js';
import { writeStep1, writeStep2, writeStep3, doneView } from './ui/write.js';
import { historyView } from './ui/history.js';
import { editView } from './ui/edit.js';
import { smsPasteView, smsCheckView } from './ui/sms.js';
import { settleView } from './ui/settle.js';

const screen = document.getElementById('screen');
const tabs = document.querySelectorAll('#tabs a');
const ctx = { db: null, settings: null, draft: null, lastSaved: null, undo: null, sms: null, smsText: '', peekText: null };

// 주소 -> 화면, 그리고 어느 아래 메뉴에 속하는지
const ROUTES = {
  '/home':   { tab: 'home',   view: (c) => homeView(c) },
  '/write':   { tab: 'home', view: (c, p) => writeStep1(c, p) },
  '/write/1': { tab: 'home', view: (c, p) => writeStep1(c, p) },
  '/write/2': { tab: 'home', view: (c) => writeStep2(c) },
  '/write/3': { tab: 'home', view: (c) => writeStep3(c) },
  '/done':    { tab: 'home', view: (c) => doneView(c) },
  '/history':      { tab: 'home', view: (c, p, q) => historyView(c, p, q) },
  '/history/:key': { tab: 'home', view: (c, p, q) => historyView(c, p, q) },
  '/edit/:id':     { tab: 'home', view: (c, p, q) => editView(c, p, q) },
  '/settle':      { tab: 'settle', view: (c, p, q) => settleView(c, p, q) },
  '/settle/:key': { tab: 'settle', view: (c, p, q) => settleView(c, p, q) },
  '/jar':    { tab: 'jar',    view: () => placeholderView('저금통', '저금통은 나중 구간에서 만들어요.') },
  '/more':   { tab: 'more',   view: () => placeholderView('더보기', '설정과 백업은 나중 구간에서 만들어요.') },
  '/sms':       { tab: 'home', view: (c) => smsPasteView(c) },
  '/sms/check': { tab: 'home', view: (c) => smsCheckView(c) },
};

// 주소 모양('/history/:key')에 맞는 화면과 값(key)을 찾는다
function resolve() {
  const path = location.hash.replace(/^#/, '') || '/home';
  const parts = path.split('/');
  for (const [pattern, route] of Object.entries(ROUTES)) {
    const pp = pattern.split('/');
    if (pp.length !== parts.length) continue;
    const params = {};
    let ok = true;
    pp.forEach((seg, i) => {
      if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]);
      else if (seg !== parts[i]) ok = false;
    });
    if (ok) return { path, route, params };
  }
  return { path: '/home', route: ROUTES['/home'], params: {} };
}

async function render() {
  const { path, route, params } = resolve();
  for (const a of tabs) {
    if (a.dataset.tab === route.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  try {
    const view = await route.view(ctx, path, params);
    screen.replaceChildren(view);
  } catch (e) {
    console.error(e);
    screen.replaceChildren(el('section', {},
      el('h1', {}, '문제가 생겼어요'),
      el('p', {}, '화면을 다시 열어 주세요. 계속 안 되면 휴대폰을 껐다 켜 보세요.')));
  }
  screen.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function applyFontScale(scale) {
  document.documentElement.style.setProperty('--scale', String(scale || 1));
}

async function start() {
  try {
    ctx.db = await initDb();
    ctx.settings = await dbGet(ctx.db, 'settings', 'main');
    applyFontScale(ctx.settings.fontScale);
  } catch (e) {
    console.error(e);
    screen.replaceChildren(el('section', {},
      el('h1', {}, '기록 공간을 열지 못했어요'),
      el('p', {}, '브라우저의 "사생활 보호 창"이 아닌 일반 창에서 열어 주세요.')));
    return;
  }
  // 브라우저가 저장 공간을 임의로 비우지 않도록 "오래 보관"을 요청한다 (허용 여부는 브라우저가 정한다)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* 지원하지 않으면 건너뜀 */ }
  window.addEventListener('hashchange', render);
  render();
}

start();

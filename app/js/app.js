/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 앱의 시작점: 저장소를 열고, 주소(#/...)에 맞는 화면을 그린다
import { initDb, dbGet } from './storage/db.js';
import { el } from './ui/dom.js';
import { homeView } from './ui/home.js';
import { writeStep1, writeStep2, writeStep3, doneView } from './ui/write.js';
import { historyView } from './ui/history.js';
import { editView } from './ui/edit.js';
import { smsPasteView, smsCheckView } from './ui/sms.js';
import { settleView } from './ui/settle.js';
import { jarView, jarFormView, jarMoveView, jarEntryView, jarDetailView, jarUsedView, jarDeleteView } from './ui/jar.js';
import { pledgeView } from './ui/pledge.js';
import { moreView } from './ui/more.js';
import { backupView, backupImportView, backupMergeView, backupReplaceView, backupUndoView } from './ui/backup.js';
import { settingsView } from './ui/settings.js';
import { aboutView } from './ui/about.js';
import { exitView } from './ui/exit.js';
import { categoriesView, categoryHideView } from './ui/categories.js';
import { introView, introSeen } from './ui/intro.js';
import { applyFontScale } from './ui/appearance.js';

const screen = document.getElementById('screen');
const tabs = document.querySelectorAll('#tabs a');
const ctx = { db: null, settings: null, draft: null, lastSaved: null, undo: null, jarUndo: null, backupNotice: null, importPending: null, sms: null, smsText: '', peekText: null, catBack: null };

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
  '/jar':           { tab: 'jar', view: (c) => jarView(c) },
  '/jar/new':       { tab: 'jar', view: (c, p) => jarFormView(c, p) },
  '/jar/edit/:id': { tab: 'jar', view: (c, p, q) => jarFormView(c, p, q) },
  '/jar/move/:id': { tab: 'jar', view: (c, p, q) => jarMoveView(c, p, q) },
  '/jar/entry/:id': { tab: 'jar', view: (c, p, q) => jarEntryView(c, p, q) },
  '/jar/open/:id':  { tab: 'jar', view: (c, p, q) => jarDetailView(c, p, q) },
  '/jar/used/:id':  { tab: 'jar', view: (c, p, q) => jarUsedView(c, p, q) },
  '/jar/delete/:id': { tab: 'jar', view: (c, p, q) => jarDeleteView(c, p, q) },
  '/pledge':        { tab: 'settle', view: (c) => pledgeView(c) },
  '/intro':  { tab: null, hideTabs: true, view: (c) => introView(c) },
  '/exit': { tab: 'home', hideTabs: true, view: (c) => exitView(c) },
  '/about': { tab: 'more', view: (c) => aboutView(c) },
  '/categories/hide/:id': { tab: 'more', view: (c, p, q) => categoryHideView(c, p, q) },
  '/categories': { tab: 'more', view: (c) => categoriesView(c) },
  '/settings': { tab: 'more', view: (c) => settingsView(c) },
  '/more':   { tab: 'more',   view: (c) => moreView(c) },
  '/backup':         { tab: 'more', view: (c) => backupView(c) },
  '/backup/import':  { tab: 'more', view: (c) => backupImportView(c) },
  '/backup/merge':   { tab: 'more', view: (c) => backupMergeView(c) },
  '/backup/replace': { tab: 'more', view: (c) => backupReplaceView(c) },
  '/backup/undo':    { tab: 'more', view: (c) => backupUndoView(c) },
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
  document.body.classList.toggle('no-tabs', !!route.hideTabs);
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
  // 처음 켠 사람에게는 소개 화면을 먼저 보여 준다 (주소가 비었거나 #/home일 때만)
  try {
    const h = location.hash.replace(/^#/, '');
    if ((h === '' || h === '/home') && !(await introSeen(ctx.db))) location.hash = '#/intro';
  } catch (e) { console.error(e); }
  window.addEventListener('hashchange', render);
  render();
}

start();

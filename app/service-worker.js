/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
/* 가계부자 서비스 워커
   - 인터넷이 되면 항상 최신 파일을 받아 오고, 안 되면 저장해 둔 파일로 보여 준다(네트워크 우선).
   - 앱을 고쳐 올린 뒤 옛 파일이 남는 일이 생기면 아래 CACHE_VERSION 숫자만 올린다. */
const CACHE_VERSION = 'v1';
const CACHE_NAME = 'gagyebuja-' + CACHE_VERSION;
/* 설치할 때 미리 저장할 파일 목록.
   START/END 사이는 _tools\update-precache.ps1 이 자동으로 채운다(손으로 고치지 않는다). */
const PRECACHE_FILES = [
  // PRECACHE-START
  './',
  './css/style.css',
  './icons/apple-touch-icon.png',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.svg',
  './icons/icon-maskable-512.png',
  './index.html',
  './js/analysis/month.js',
  './js/app.js',
  './js/content/phrases.js',
  './js/parser/sms.js',
  './js/storage/attendance.js',
  './js/storage/backup.js',
  './js/storage/cheer.js',
  './js/storage/dates.js',
  './js/storage/db.js',
  './js/storage/defaults.js',
  './js/storage/jars.js',
  './js/storage/jarUse.js',
  './js/storage/pledgeCheck.js',
  './js/storage/pledges.js',
  './js/storage/smsRecords.js',
  './js/storage/transactions.js',
  './js/ui/about.js',
  './js/ui/amountField.js',
  './js/ui/appearance.js',
  './js/ui/backup.js',
  './js/ui/categories.js',
  './js/ui/dom.js',
  './js/ui/edit.js',
  './js/ui/effects.js',
  './js/ui/exit.js',
  './js/ui/format.js',
  './js/ui/history.js',
  './js/ui/home.js',
  './js/ui/intro.js',
  './js/ui/jar.js',
  './js/ui/more.js',
  './js/ui/placeholder.js',
  './js/ui/pledge.js',
  './js/ui/settings.js',
  './js/ui/settle.js',
  './js/ui/sms.js',
  './js/ui/stamps.js',
  './js/ui/write.js',
  './manifest.json'
  // PRECACHE-END
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(PRECACHE_FILES.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('gagyebuja-') && k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // 외부 주소(글꼴 등)는 건드리지 않는다
  if (url.pathname.indexOf('/dev/') !== -1) return;     // 시험용 화면은 저장하지 않는다

  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) =>
          hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)
        )
      )
  );
});

/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 백업 시험 항목 (브라우저 시험 화면 backup-test.html과 PC 자동 시험이 함께 쓴다)
import { initDb, deleteDb, dbGet, dbGetAll, dbPut } from '../js/storage/db.js';
import { addTransaction, softDeleteTransaction, updateTransaction } from '../js/storage/transactions.js';
import { createJar, addMoved, softDeleteEntry, listJars, listEntries } from '../js/storage/jars.js';
import {
  buildBackup, serializeBackup, backupFileName, inspectBackup, countCurrent, planMerge, previewMerge,
  importReplace, importMerge, getUndoInfo, undoImport, markBackedUp, getLastBackupAt, dismissReminder,
  decideReminder, computeReminder, TEMP_KEY,
} from '../js/storage/backup.js';

const DAY = 86400000;

export async function runChecks() {
  const results = [];
  const check = (label, pass, detail = '') => results.push({ label, pass: !!pass, detail });
  const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.userMessage || String(e); } };
  const A = 'gagyebuja-db-test-backup-a', B = 'gagyebuja-db-test-backup-b';

  try {
    await deleteDb(A); await deleteDb(B);
    const a = await initDb(A);

    // ---- 파일 만들기 ----
    const t1 = await addTransaction(a, { type: 'expense', amount: 12000, date: '2026-10-20', categoryId: 'c01', merchant: '마트' });
    const t2 = await addTransaction(a, { type: 'income', amount: 1500000, date: '2026-10-21', categoryId: 'i01' });
    const t3 = await addTransaction(a, { type: 'expense', amount: 5000, date: '2026-10-22', categoryId: 'c03', dedupeKey: 'KEY-SMS-1', source: 'sms_paste' });
    const t4 = await addTransaction(a, { type: 'expense', amount: 7000, date: '2026-10-23', categoryId: 'c01' });
    await softDeleteTransaction(a, t4.id);
    const jar = await createJar(a, { name: '손주 선물', targetAmount: 300000 });
    const e1 = await addMoved(a, { jarId: jar.id, amount: 100000, date: '2026-10-24' });
    await dbPut(a, 'merchants', { normalizedName: '마트', categoryId: 'c01', useCount: 2, lastUsedAt: 1000, learnedType: 'expense' });

    const backup = await buildBackup(a, new Date(2026, 9, 25, 20, 30, 5));
    check('파일 이름에 날짜가 들어간다', backupFileName(new Date(2026, 9, 25)) === 'gagyebuja-backup-2026-10-25.json');
    check('형식·버전 표시가 있다', backup.format === 'gagyebuja-backup' && backup.schemaVersion === 1 && backup.appVersion === '0.1.0');
    check('만든 시각에 시간대가 붙는다', /^2026-10-25T20:30:05[+-]\d\d:\d\d$/.test(backup.exportedAt), backup.exportedAt);
    check('기록·분류·저금통·설정이 들어 있다',
      backup.data.transactions.length === 4 && backup.data.categories.length === 19 && backup.data.jars.length === 1 &&
      backup.data.jarEntries.length === 1 && backup.data.settings.key === 'main' && backup.data.merchants.length === 1);
    check('삭제 표시한 기록도 파일에 담긴다', backup.data.transactions.some((t) => t.id === t4.id && t.deletedAt));
    check('임시 보관·본 문구는 파일에 넣지 않는다', !('tempBackups' in backup.data) && !('phraseSeen' in backup.data));
    check('4단계용 balanceChecks 자리가 비어 있다', Array.isArray(backup.data.balanceChecks) && backup.data.balanceChecks.length === 0);
    check('문자 원문 칸이 없다(해시만 있다)', !JSON.stringify(backup).includes('Web발신'));

    // ---- 파일 검사 ----
    const text = serializeBackup(backup);
    const ok = inspectBackup(text);
    check('내가 만든 파일은 읽을 수 있다', ok.ok && ok.info.recordCount === 3 && ok.info.schemaVersion === 1, JSON.stringify(ok.info));
    check('안내용 기록 건수는 삭제 표시한 것을 뺀다', ok.info.recordCount === 3);
    const brk = (obj) => inspectBackup(typeof obj === 'string' ? obj : JSON.stringify(obj));
    const clone = () => JSON.parse(text);
    check('글자가 깨진 파일은 거절한다', brk('{ 깨짐').reason === 'broken');
    check('빈 파일은 거절한다', brk('').reason === 'broken');
    check('다른 앱의 JSON은 거절한다', brk({ hello: 1 }).reason === 'broken' && brk([1, 2]).reason === 'broken');
    let o = clone(); o.schemaVersion = 2;
    check('앱보다 새 버전 파일은 "newer"로 거절한다', brk(o).reason === 'newer');
    o = clone(); o.schemaVersion = 'x';
    check('버전 표시가 이상하면 거절한다', brk(o).reason === 'broken');
    o = clone(); delete o.data.transactions;
    check('필수 기록 칸이 없으면 거절한다', brk(o).reason === 'broken');
    o = clone(); o.data.transactions[0].amount = -5;
    check('금액이 이상한 기록이 있으면 거절한다', brk(o).reason === 'broken');
    o = clone(); o.data.transactions[0].date = '2026-02-30';
    check('없는 날짜가 있으면 거절한다', brk(o).reason === 'broken');
    o = clone(); o.data.transactions[0].type = 'gift';
    check('종류를 모르는 기록이 있으면 거절한다', brk(o).reason === 'broken');
    o = clone(); o.data.jarEntries[0].kind = 'wat';
    check('저금통 기록 종류가 이상하면 거절한다', brk(o).reason === 'broken');
    o = clone(); o.data.settings = [];
    check('설정 모양이 이상하면 거절한다', brk(o).reason === 'broken');
    o = clone(); o.data.transactions = {};
    check('기록 칸이 목록이 아니면 거절한다', brk(o).reason === 'broken');
    o = clone(); delete o.data.pledges; delete o.data.badges;
    check('선택 칸이 없는 파일은 읽을 수 있다', brk(o).ok === true);
    const before = JSON.stringify(await dbGetAll(a, 'transactions'));
    check('검사는 아무것도 바꾸지 않는다', before === JSON.stringify(await dbGetAll(a, 'transactions')));

    // ---- 바꾸기: 다른 기기(B)에 불러온다 ----
    const b = await initDb(B);
    const tb = await addTransaction(b, { type: 'expense', amount: 999, date: '2026-10-01', categoryId: 'c01' });
    await dbPut(b, 'settings', { ...(await dbGet(b, 'settings', 'main')), fontScale: 1.3 });
    check('불러오기 전에는 되돌릴 것이 없다', (await getUndoInfo(b)) === null);
    await importReplace(b, ok.backup);
    const bTx = await dbGetAll(b, 'transactions');
    check('바꾸기: 지금 기록이 사라지고 파일의 기록이 된다', bTx.length === 4 && !bTx.some((t) => t.id === tb.id));
    check('바꾸기: 삭제 표시도 그대로 옮겨 간다', bTx.find((t) => t.id === t4.id).deletedAt > 0);
    check('바꾸기: 저금통 칸과 옮긴 기록이 옮겨 간다', (await listJars(b)).length === 1 && (await listEntries(b, jar.id)).length === 1);
    check('바꾸기: 분류 19개가 유지된다', (await dbGetAll(b, 'categories')).length === 19);
    check('바꾸기: 설정은 파일의 것을 쓴다(글씨 크기 1.3 → 파일의 1)', (await dbGet(b, 'settings', 'main')).fontScale === 1);
    const un = await getUndoInfo(b);
    check('바꾸기 뒤에 되돌릴 수 있고 임시 보관은 불러오기 전 기록 1건이다', un && un.recordCount === 1, JSON.stringify(un));
    await undoImport(b);
    const bBack = await dbGetAll(b, 'transactions');
    check('되돌리기: 불러오기 전 기록으로 돌아간다', bBack.length === 1 && bBack[0].id === tb.id);
    check('되돌리기: 설정도 돌아간다(글씨 크기 1.3)', (await dbGet(b, 'settings', 'main')).fontScale === 1.3);
    check('되돌리기: 저금통은 불러오기 전 상태(없음)다', (await listJars(b)).length === 0);
    check('되돌리기를 마치면 임시 보관이 지워진다', (await getUndoInfo(b)) === null && !(await dbGet(b, 'tempBackups', TEMP_KEY)));
    check('되돌릴 것이 없을 때 되돌리기는 쉬운 말로 거절한다', !!(await fails(() => undoImport(b))));

    // 임시 보관 7일
    await importReplace(b, ok.backup);
    const tmp = await dbGet(b, 'tempBackups', TEMP_KEY);
    check('임시 보관은 7일 안에는 남는다', (await getUndoInfo(b, tmp.createdAt + 6 * DAY)) !== null);
    check('임시 보관은 7일이 지나면 지워진다', (await getUndoInfo(b, tmp.createdAt + 8 * DAY)) === null && !(await dbGet(b, 'tempBackups', TEMP_KEY)));

    // ---- 합치기 계산(순수 계산) ----
    const L = (x) => ({ transactions: [], jars: [], jarEntries: [], merchants: [], categories: [], pledges: [], pledgeResults: [], restCardUses: [], badges: [], reviews: [], ...x });
    const tx = (id, extra = {}) => ({ id, type: 'expense', date: '2026-10-01', amount: 100, categoryId: 'c01', createdAt: 100, updatedAt: 100, ...extra });
    let p = planMerge(L({ transactions: [tx('x1')] }), L({ transactions: [tx('x1'), tx('x2')] }));
    check('합치기: 같은 번호는 두고 파일에만 있는 것을 더한다', p.addedRecords === 1 && p.put.transactions.length === 1 && p.put.transactions[0].id === 'x2');
    p = planMerge(L({ transactions: [tx('x1', { amount: 100, updatedAt: 200 })] }), L({ transactions: [tx('x1', { amount: 500, updatedAt: 300 })] }));
    check('합치기: 같은 번호는 늦게 고친 파일 쪽이 이긴다', p.updatedRecords === 1 && p.put.transactions[0].amount === 500);
    p = planMerge(L({ transactions: [tx('x1', { amount: 100, updatedAt: 300 })] }), L({ transactions: [tx('x1', { amount: 500, updatedAt: 200 })] }));
    check('합치기: 지금 것이 더 늦게 고쳤으면 지금 것을 지킨다', !p.put.transactions && p.updatedRecords === 0);
    p = planMerge(L({ transactions: [tx('x1', { amount: 100, updatedAt: 300 })] }), L({ transactions: [tx('x1', { amount: 500, updatedAt: 300 })] }));
    check('합치기: 같은 시각이면 지금 것을 지킨다', !p.put.transactions);
    p = planMerge(L({ transactions: [tx('x1', { updatedAt: 200 })] }), L({ transactions: [tx('x1', { updatedAt: 300, deletedAt: 300 })] }));
    check('합치기: 파일에서 더 늦게 삭제했으면 삭제 표시가 옮겨 온다', p.put.transactions[0].deletedAt === 300 && p.addedRecords === 0);
    p = planMerge(L({ transactions: [tx('x1', { dedupeKey: 'K' })] }), L({ transactions: [tx('y9', { dedupeKey: 'K' })] }));
    check('합치기: 같은 문자(해시 같음)는 번호가 달라도 더하지 않는다', p.skippedDuplicates === 1 && !p.put.transactions && p.addedRecords === 0);
    p = planMerge(L({ transactions: [tx('x1', { dedupeKey: 'K', deletedAt: 5, updatedAt: 5 })] }), L({ transactions: [tx('y9', { dedupeKey: 'K' })] }));
    check('합치기: 지금 쪽이 삭제 표시한 문자는 중복으로 보지 않는다', p.addedRecords === 1);
    p = planMerge(L({}), L({ transactions: [tx('z1', { deletedAt: 9, updatedAt: 9 })] }));
    check('합치기: 삭제 표시만 있는 새 기록은 더하되 건수에는 세지 않는다', p.put.transactions.length === 1 && p.addedRecords === 0);
    p = planMerge(L({ categories: [{ id: 'c01', name: '식비', kind: 'expense' }] }),
      L({ categories: [{ id: 'c01', name: '바뀐이름', kind: 'expense' }, { id: 'u1', name: '내 분류', kind: 'expense', isUserDefined: true }] }));
    check('합치기: 기본 분류는 지금 것, 사용자 분류만 더한다', p.put.categories.length === 1 && p.put.categories[0].id === 'u1');
    p = planMerge(L({ merchants: [{ normalizedName: '마트', lastUsedAt: 500 }] }), L({ merchants: [{ normalizedName: '마트', lastUsedAt: 400 }, { normalizedName: '약국', lastUsedAt: 1 }] }));
    check('합치기: 가맹점은 더 최근에 쓴 쪽을 남기고 새 가맹점을 더한다', p.put.merchants.length === 1 && p.put.merchants[0].normalizedName === '약국');
    p = planMerge(L({ merchants: [{ normalizedName: '마트', lastUsedAt: 100 }] }), L({ merchants: [{ normalizedName: '마트', lastUsedAt: 400 }] }));
    check('합치기: 파일의 가맹점이 더 최근이면 바뀐다', p.put.merchants[0].lastUsedAt === 400);

    const jr = (id, extra = {}) => ({ id, name: '칸' + id, targetAmount: 1000, status: 'active', createdAt: 10, ...extra });
    const je = (id, jarId, extra = {}) => ({ id, jarId, kind: 'moved', date: '2026-10-01', amount: 10, createdAt: 10, ...extra });
    p = planMerge(L({ jars: [jr('j1')], jarEntries: [je('e1', 'j1')] }), L({ jars: [jr('j1')], jarEntries: [je('e1', 'j1'), je('e2', 'j1')] }));
    check('합치기: 같은 칸의 새 저금통 기록을 더한다', p.addedJarEntries === 1 && !p.put.jars && p.skippedJarNames.length === 0);
    p = planMerge(L({ jars: [jr('j1'), jr('j2'), jr('j3')] }), L({ jars: [jr('j4', { name: '여행' })], jarEntries: [je('e5', 'j4')] }));
    check('합치기: 칸이 3개를 넘으면 새 칸과 그 기록을 더하지 않고 알린다', !p.put.jars && !p.put.jarEntries && p.skippedJarNames[0] === '여행' && p.addedJarEntries === 0);
    p = planMerge(L({ jars: [jr('j1')] }), L({ jars: [jr('j2', { name: '여행' })], jarEntries: [je('e5', 'j2')] }));
    check('합치기: 칸이 3개 미만이면 새 칸과 그 기록이 들어온다', p.put.jars.length === 1 && p.addedJarEntries === 1 && p.skippedJarNames.length === 0);
    p = planMerge(L({}), L({ jars: [jr('j2', { name: '여행' })], jarEntries: [je('e5', 'j2')] }));
    check('합치기: 지금 칸이 없으면 파일의 칸과 기록이 들어온다', p.put.jars.length === 1 && p.addedJarEntries === 1);
    p = planMerge(L({ jars: [jr('j1')] }), L({ jarEntries: [je('e9', 'nope')] }));
    check('합치기: 주인 칸이 없는 저금통 기록은 더하지 않는다', !p.put.jarEntries);
    p = planMerge(L({ jars: [jr('j1')], jarEntries: [je('e1', 'j1')] }), L({ jars: [jr('j1')], jarEntries: [je('e1', 'j1', { deletedAt: 50 })] }));
    check('합치기: 파일에서 지운 저금통 기록의 삭제 표시가 옮겨 온다', p.put.jarEntries[0].deletedAt === 50);

    // ---- 합치기 실제 쓰기 (A의 파일을 C에 합친다) ----
    const C = 'gagyebuja-db-test-backup-c';
    await deleteDb(C);
    const c = await initDb(C);
    const tc = await addTransaction(c, { type: 'expense', amount: 3000, date: '2026-10-02', categoryId: 'c01' });
    const sameSms = await addTransaction(c, { type: 'expense', amount: 5000, date: '2026-10-22', categoryId: 'c03', dedupeKey: 'KEY-SMS-1', source: 'sms_paste' });
    await dbPut(c, 'settings', { ...(await dbGet(c, 'settings', 'main')), fontScale: 1.5, coachStyle: 'captain' });
    const pv = await previewMerge(c, ok.backup);
    check('미리 계산: 파일의 3건 중 문자 1건이 겹쳐 2건이 더해진다', pv.addedRecords === 2 && pv.skippedDuplicates === 1, JSON.stringify(pv));
    check('미리 계산은 아무것도 쓰지 않는다', (await dbGetAll(c, 'transactions')).length === 2 && (await getUndoInfo(c)) === null);
    const sum = await importMerge(c, ok.backup);
    const cTx = await dbGetAll(c, 'transactions');
    check('합치기 결과 건수가 미리 계산과 같다', sum.addedRecords === 2 && sum.skippedDuplicates === 1);
    check('합치기: 지금 기록 2건 + 새 기록 2건 + 삭제 표시 1건 = 5건 저장', cTx.length === 5, String(cTx.length));
    check('합치기: 같은 문자는 한 번만 있다', cTx.filter((t) => t.dedupeKey === 'KEY-SMS-1').length === 1);
    check('합치기: 지금 설정을 유지한다', (await dbGet(c, 'settings', 'main')).fontScale === 1.5 && (await dbGet(c, 'settings', 'main')).coachStyle === 'captain');
    check('합치기: 저금통 칸과 기록이 들어온다', (await listJars(c)).length === 1 && (await listEntries(c, jar.id)).length === 1);
    check('합치기: 가맹점이 들어온다', !!(await dbGet(c, 'merchants', '마트')));
    const cu = await getUndoInfo(c);
    check('합치기 뒤에도 되돌릴 수 있다(합치기 전 기록 2건)', cu && cu.recordCount === 2);
    await undoImport(c);
    check('합치기 되돌리기: 합치기 전과 똑같아진다', (await dbGetAll(c, 'transactions')).length === 2 && (await listJars(c)).length === 0);
    const again = await importMerge(c, ok.backup);
    const twice = await importMerge(c, ok.backup);
    check('같은 파일을 두 번 합쳐도 더 늘지 않는다', twice.addedRecords === 0 && twice.updatedRecords === 0 && (await dbGetAll(c, 'transactions')).length === 5);
    check('합치기를 해도 기록 번호가 겹치지 않는다', new Set((await dbGetAll(c, 'transactions')).map((t) => t.id)).size === 5);

    // 합치기 중 실패하면 아무것도 바뀌지 않는다
    const D = 'gagyebuja-db-test-backup-d';
    await deleteDb(D);
    const d = await initDb(D);
    await addTransaction(d, { type: 'expense', amount: 1, date: '2026-10-02', categoryId: 'c01' });
    const bad = JSON.parse(text);
    bad.data.transactions[0].id = { notAString: true };   // 검사를 거치지 않고 억지로 넣어 저장 실패를 만든다
    const err = await fails(() => importReplace(d, bad));
    check('저장 중 실패하면 오류로 알리고 기록을 하나도 바꾸지 않는다(임시 보관도 안 남김)',
      err !== null && (await dbGetAll(d, 'transactions')).length === 1 && (await getUndoInfo(d)) === null, String(err));
    d.close(); await deleteDb(D);

    // 옛 분류 이름으로 만든 파일도 번호가 같으면 이어진다
    const old = JSON.parse(text);
    old.data.categories = old.data.categories.map((x) => (x.id === 'i01' ? { ...x, name: '연금' } : x));
    const E = 'gagyebuja-db-test-backup-e';
    await deleteDb(E);
    const e = await initDb(E);
    await importReplace(e, inspectBackup(JSON.stringify(old)).backup);
    check('옛 분류 이름의 파일을 불러오면 분류 이름이 새 이름으로 맞춰진다', (await dbGet(e, 'categories', 'i01')).name === '연금소득');
    const slim = JSON.parse(text); slim.data.categories = [];
    await importReplace(e, inspectBackup(JSON.stringify(slim)).backup);
    check('분류가 비어 있는 파일을 불러오면 기본 분류 19개를 다시 채운다', (await dbGetAll(e, 'categories')).length === 19);
    e.close(); await deleteDb(E);

    // ---- 마지막 백업일 ----
    check('처음에는 마지막 백업일이 없다', (await getLastBackupAt(a)) === null);
    await dismissReminder(a, 111);
    await markBackedUp(a, 5000);
    check('저장하면 마지막 백업일이 남는다', (await getLastBackupAt(a)) === 5000);
    check('저장하면 "나중에" 표시가 지워진다', !(await dbGet(a, 'meta', 'backupReminderDismissedAt')));

    // ---- 홈 안내 줄 (D45 제안값) ----
    const N = 100 * DAY;
    const r = (x) => decideReminder({ recordCount: 0, newSinceBackup: 0, lastBackupAt: null, dismissedAt: null, now: N, ...x });
    check('안내: 기록 9건이고 저장한 적 없으면 안 보인다', r({ recordCount: 9 }) === null);
    check('안내: 기록 10건이고 저장한 적 없으면 보인다', r({ recordCount: 10 }).reason === 'never');
    check('안내: 저장한 지 13일, 새 기록 5건이면 안 보인다', r({ lastBackupAt: N - 13 * DAY, newSinceBackup: 5, recordCount: 50 }) === null);
    check('안내: 저장한 지 14일, 새 기록 5건이면 보인다', r({ lastBackupAt: N - 14 * DAY, newSinceBackup: 5, recordCount: 50 }).reason === 'days');
    check('안내: 저장한 지 14일이어도 새 기록이 없으면 안 보인다', r({ lastBackupAt: N - 30 * DAY, newSinceBackup: 0, recordCount: 50 }) === null);
    check('안내: 새 기록 29건이면 안 보인다', r({ lastBackupAt: N - 1 * DAY, newSinceBackup: 29, recordCount: 50 }) === null);
    check('안내: 새 기록 30건이면 보인다', r({ lastBackupAt: N - 1 * DAY, newSinceBackup: 30, recordCount: 50 }).reason === 'new');
    check('안내: "나중에"를 누른 지 2일이면 안 보인다', r({ recordCount: 10, dismissedAt: N - 2 * DAY }) === null);
    check('안내: "나중에"를 누른 지 3일이면 다시 보인다', r({ recordCount: 10, dismissedAt: N - 3 * DAY }) !== null);

    // 저장소에서 계산하는 안내
    const F = 'gagyebuja-db-test-backup-f';
    await deleteDb(F);
    const f = await initDb(F);
    check('기록이 없는 새 앱에는 안내가 없다', (await computeReminder(f)) === null);
    for (let i = 0; i < 10; i++) await addTransaction(f, { type: 'expense', amount: 100 + i, date: '2026-10-01', categoryId: 'c01' });
    const rem = await computeReminder(f);
    check('기록 10건이고 저장한 적 없으면 저장소 기준으로도 보인다', rem && rem.reason === 'never');
    await dismissReminder(f);
    check('"나중에" 뒤에는 바로 안 보인다', (await computeReminder(f)) === null);
    await markBackedUp(f, Date.now() - 20 * DAY);
    check('20일 전에 저장했고 그 뒤 새 기록이 10건이면 날짜 안내가 보인다', (await computeReminder(f)).reason === 'days');
    await markBackedUp(f, Date.now() + 1000);
    check('방금 저장했으면 안내가 사라진다', (await computeReminder(f)) === null);
    f.close(); await deleteDb(F);

    check('기록 수 세기는 삭제 표시를 뺀다', (await countCurrent(a)).recordCount === 3);

    a.close(); b.close(); c.close();
    await deleteDb(A); await deleteDb(B); await deleteDb(C);
  } catch (e) {
    check('시험 중 오류 없음', false, String((e && e.stack) || e));
  }
  return results;
}

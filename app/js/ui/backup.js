// S12 백업 (화면흐름 v1.2, 데이터구조 4번, D45, D61)
// 흐름: [내 기록 저장하기] / [저장한 기록 불러오기] → (파일 안내) → 바꾸기·합치기 고르기 → 확인 질문 → 끝난 뒤 [방금 가져오기 되돌리기]
import { el } from './dom.js';
import { formatDateKo } from './format.js';
import { toDateStr, isValidDateStr } from '../storage/dates.js';
import { dbGet } from '../storage/db.js';
import {
  buildBackup, serializeBackup, backupFileName, inspectBackup, countCurrent, previewMerge,
  importReplace, importMerge, getUndoInfo, undoImport, markBackedUp, getLastBackupAt, MAX_FILE_BYTES,
} from '../storage/backup.js';
import { applyFontScale } from './appearance.js';

const DAY = 24 * 60 * 60 * 1000;
const CANNOT_READ = '이 파일은 읽을 수 없어요. 이 앱에서 "내 기록 저장하기"로 만든 파일을 골라 주세요.';
const TOO_NEW = '이 파일은 더 새로운 버전의 앱에서 만든 파일이에요. 앱을 새 버전으로 바꾼 뒤 다시 시도해 주세요.';

// 불러온 뒤 화면 설정(글씨 크기 등)을 새 값으로 맞춘다
async function refreshSettings(ctx) {
  ctx.settings = await dbGet(ctx.db, 'settings', 'main');
  applyFontScale(ctx.settings.fontScale);
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function lastBackupParts(lastBackupAt) {
  if (!lastBackupAt) return { date: '아직 저장한 적이 없어요', ago: '' };
  const days = Math.floor((Date.now() - lastBackupAt) / DAY);
  return { date: formatDateKo(toDateStr(new Date(lastBackupAt))), ago: days <= 0 ? '오늘 저장했어요' : days + '일 전' };
}

function fileDateText(exportedAt) {
  const d = String(exportedAt || '').slice(0, 10);
  return isValidDateStr(d) ? formatDateKo(d) : '알 수 없어요';
}

// ---- S12 메인 ----
function kv(label, value) {
  return el('div', { class: 'kv-item' }, el('p', { class: 'kicker' }, label), el('p', { class: 'kv-value' }, value));
}

export async function backupView(ctx) {
  const box = el('section', {});
  let notice = ctx.backupNotice || null;   // 불러오기·되돌리기가 끝난 직후 한 번만 보인다
  ctx.backupNotice = null;

  const status = el('div', { class: 'banner', role: 'status', hidden: true });
  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const showStatus = (text) => { status.replaceChildren(el('span', {}, text)); status.hidden = false; alertBox.hidden = true; };
  const showAlert = (text) => { alertBox.textContent = text; alertBox.hidden = false; status.hidden = true; };

  // 내려받기는 브라우저가 저장 창에서 취소됐는지 앱에 알려 주지 않는다. 그래서 사람에게 직접 확인받는다.
  const confirmBox = el('div', { class: 'banner', role: 'alertdialog', hidden: true });
  const hideConfirm = () => { confirmBox.hidden = true; confirmBox.replaceChildren(); };
  const askSaved = (fileName) => {
    status.hidden = true; alertBox.hidden = true;
    confirmBox.replaceChildren(
      el('span', {}, '파일이 저장됐나요? 저장 창이 떴다면 [저장]을 누른 뒤에 답해 주세요. (' + fileName + ')'),
      el('div', { class: 'banner-actions' },
        el('button', { type: 'button', class: 'btn primary', onclick: async () => {
          hideConfirm();
          try { await markBackedUp(ctx.db); await paint(); showStatus('저장했어요. "다운로드" 폴더(삼성 폰은 "내 파일" 앱)에서 ' + fileName + ' 파일을 찾을 수 있어요.'); }
          catch (e) { console.error(e); showAlert('저장 기록을 남기지 못했어요. 한 번 더 눌러 주세요.'); }
        } }, '네, 저장됐어요'),
        el('button', { type: 'button', class: 'btn', onclick: () => {
          hideConfirm(); showStatus('저장하지 않았어요. 기록은 그대로예요. 다시 하시려면 [내 기록 저장하기]를 눌러 주세요.');
        } }, '아니요')));
    confirmBox.hidden = false;
  };

  const saveBtn = el('button', { type: 'button', class: 'btn primary' }, '내 기록 저장하기');
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  const pickBtn = el('button', { type: 'button', class: 'btn' }, '저장한 기록 불러오기');
  pickBtn.addEventListener('click', () => { alertBox.hidden = true; fileInput.click(); });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    alertBox.hidden = true;
    hideConfirm();
    try {
      const fileName = backupFileName();
      let handle = null;
      // PC 크롬·엣지: 저장 창에서 [저장]/[취소]를 앱이 정확히 알 수 있다. 버튼을 누른 직후에 먼저 연다.
      if (typeof window.showSaveFilePicker === 'function') {
        try {
          handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: '가계부자 기록 파일', accept: { 'application/json': ['.json'] } }],
          });
        } catch (e) {
          if (e && e.name === 'AbortError') {
            showStatus('저장을 그만두셨어요. 기록은 그대로예요.');
            return;
          }
          console.warn('저장 창을 열지 못해 다른 방법으로 이어 가요:', e);
        }
      }
      const backup = await buildBackup(ctx.db);
      const file = new File([serializeBackup(backup)], fileName, { type: 'application/json' });
      let how = 'download';
      let lastError = null;
      if (handle) {
        try {
          const w = await handle.createWritable();
          await w.write(file);
          await w.close();
          how = 'picker';
        } catch (e) {
          // 저장 창은 열렸지만 파일에 쓰지 못한 경우(일부 브라우저): 다른 방법으로 이어 간다
          console.warn('저장 창으로 쓰지 못했어요:', e);
          lastError = e;
          handle = null;
        }
      }
      if (how !== 'picker' && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: '가계부자 내 기록' });
          how = 'share';
        } catch (e) {
          if (e && e.name === 'AbortError') {      // 공유 창을 닫은 것: 저장하지 않은 것으로 본다
            showStatus('저장을 그만두셨어요. 기록은 그대로예요.');
            return;
          }
          console.warn('공유 창을 열지 못해 내려받기로 이어 가요:', e);
          lastError = e;
        }
      }
      notice = null;
      if (how === 'download') {
        downloadFile(file);
        askSaved(file.name);                      // 확인을 받은 뒤에만 "저장함"으로 기록한다
        return;
      }
      await markBackedUp(ctx.db);
      await paint();
      showStatus(how === 'picker'
        ? '저장했어요. 고르신 곳에 ' + file.name + ' 파일이 있어요.'
        : '저장했어요. 공유 창에서 고르신 곳에 파일이 있어요.');
    } catch (e) {
      console.error(e);
      showAlert('저장하지 못했어요. 한 번 더 눌러 주세요.' + (e && e.name ? ' (오류: ' + e.name + ')' : ''));
    } finally {
      saveBtn.disabled = false;
    }
  });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';                           // 같은 파일을 다시 골라도 반응하도록 비운다
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) { showAlert(CANNOT_READ); return; }
    let text;
    try { text = await f.text(); } catch (e) { showAlert(CANNOT_READ); return; }
    const res = inspectBackup(text);
    if (!res.ok) { showAlert(res.reason === 'newer' ? TOO_NEW : CANNOT_READ); return; }
    ctx.importPending = { backup: res.backup, info: res.info, fileName: f.name };
    location.hash = '#/backup/import';
  });

  async function paint() {
    const [lastBackupAt, undo] = await Promise.all([getLastBackupAt(ctx.db), getUndoInfo(ctx.db)]);
    const last = lastBackupParts(lastBackupAt);
    const children = [
      el('h1', {}, '내 기록 저장·불러오기'),
      notice ? el('div', { class: 'banner', role: 'status' }, el('span', {}, notice)) : null,
      status, alertBox, confirmBox,
      el('div', { class: 'card' },
        el('p', { class: 'kicker' }, '마지막으로 저장한 날'),
        el('p', { class: 'row-value tight' }, last.date),
        last.ago ? el('p', { class: 'meta' }, last.ago) : null,
        el('p', { class: 'note' }, '내 기록은 이 휴대폰 안에만 있어요. 파일로 저장해 두면 휴대폰을 바꿔도 다시 불러올 수 있어요.')),
      saveBtn,
      el('p', { class: 'note warn' }, '이 파일에는 가계 기록이 들어 있어요. 남에게 보내지 마세요.'),
      el('hr', { class: 'sep' }),
      pickBtn, fileInput,
      el('p', { class: 'note' }, '다른 앱(크롬, 삼성 인터넷 등)에서 쓴 기록을 한곳에 모을 때도 이 방법을 써요.'),
    ];
    if (undo) {
      children.push(
        el('hr', { class: 'sep' }),
        el('div', { class: 'card' },
          el('p', { class: 'line-tight' }, '불러오기를 잘못하셨나요?'),
          el('p', { class: 'note' }, '불러오기 전의 기록(' + undo.recordCount + '건)으로 돌아갈 수 있어요.')),
        el('a', { class: 'btn', href: '#/backup/undo' }, '방금 가져오기 되돌리기'));
    }
    children.push(el('a', { class: 'btn', href: '#/more' }, '더보기로'));
    box.replaceChildren(...children.filter(Boolean));
  }

  await paint();
  return box;
}

// 파일을 고른 뒤: 파일 안내와 바꾸기·합치기 고르기
export async function backupImportView(ctx) {
  const p = ctx.importPending;
  if (!p) {
    return el('section', {},
      el('h1', {}, '먼저 파일을 골라 주세요'),
      el('a', { class: 'btn primary', href: '#/backup' }, '돌아가기'));
  }
  const cur = await countCurrent(ctx.db);
  return el('section', {},
    el('h1', {}, '이 파일을 불러올까요?'),
    el('div', { class: 'card' },
      kv('파일 이름', p.fileName),
      kv('만든 날', fileDateText(p.info.exportedAt)),
      kv('파일 안의 기록', p.info.recordCount + '건'),
      kv('지금 이 앱의 기록', cur.recordCount + '건')),
    el('h2', {}, '어떻게 불러올까요?'),
    el('p', { class: 'note' }, '지금 기록은 그대로 두고, 파일에만 있는 기록을 더해요. 다른 앱에서 쓴 기록을 한곳에 모을 때 좋아요.'),
    el('a', { class: 'btn primary', href: '#/backup/merge' }, '합치기'),
    el('p', { class: 'note warn' }, '지금 기록을 모두 지우고 파일의 기록으로 바꿔요. 새 휴대폰으로 옮길 때 좋아요.'),
    el('a', { class: 'btn', href: '#/backup/replace' }, '바꾸기'),
    el('a', { class: 'btn', href: '#/backup', onclick: () => { ctx.importPending = null; } }, '그만둘게요'),
  );
}

// 합치기 확인 질문
export async function backupMergeView(ctx) {
  const p = ctx.importPending;
  if (!p) return backupImportView(ctx);
  const plan = await previewMerge(ctx.db, p.backup);

  const lines = [
    '파일의 기록 ' + p.info.recordCount + '건 중 새로 더해지는 것은 ' + plan.addedRecords + '건이에요. 지금 기록은 그대로 남아요.',
  ];
  if (plan.updatedRecords > 0) lines.push('파일 쪽이 더 최근에 고친 ' + plan.updatedRecords + '건은 파일의 내용으로 바뀌어요.');
  if (plan.skippedDuplicates > 0) lines.push('같은 문자로 이미 기록돼 있는 ' + plan.skippedDuplicates + '건은 더하지 않아요.');
  if (plan.addedJarEntries > 0) lines.push('저금통 기록 ' + plan.addedJarEntries + '건도 더해져요.');
  if (plan.skippedJarNames.length > 0) lines.push('저금통 칸은 지금 1개까지라서 파일의 "' + plan.skippedJarNames.join('", "') + '" 칸과 그 기록은 더하지 않아요.');
  lines.push('끝난 뒤에도 [방금 가져오기 되돌리기]로 돌아갈 수 있어요.');

  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const go = el('button', { type: 'button', class: 'btn primary' }, '합칠게요');
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const r = await importMerge(ctx.db, p.backup);
      await refreshSettings(ctx);
      ctx.importPending = null;
      ctx.backupNotice = '합쳤어요. 새로 더해진 기록은 ' + r.addedRecords + '건이에요.';
      location.hash = '#/backup';
    } catch (e) {
      console.error(e);
      alertBox.textContent = '합치지 못했어요. 기록은 그대로예요. 한 번 더 눌러 주세요.';
      alertBox.hidden = false;
      go.disabled = false;
    }
  });
  return el('section', {},
    el('h1', {}, '이렇게 합칠까요?'),
    el('div', { class: 'card' }, lines.map((t) => el('p', { class: 'line-tight' }, t))),
    alertBox,
    go,
    el('a', { class: 'btn', href: '#/backup/import' }, '그만둘게요'),
  );
}

// 바꾸기 확인 질문 (안전한 [그만둘게요]를 위쪽 주된 버튼으로, D60)
export async function backupReplaceView(ctx) {
  const p = ctx.importPending;
  if (!p) return backupImportView(ctx);
  const cur = await countCurrent(ctx.db);
  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const go = el('button', { type: 'button', class: 'btn danger' }, '바꿀게요');
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const r = await importReplace(ctx.db, p.backup);
      await refreshSettings(ctx);
      ctx.importPending = null;
      ctx.backupNotice = '불러왔어요. 기록 ' + r.recordCount + '건으로 바뀌었어요.';
      location.hash = '#/backup';
    } catch (e) {
      console.error(e);
      alertBox.textContent = '바꾸지 못했어요. 기록은 그대로예요. 한 번 더 눌러 주세요.';
      alertBox.hidden = false;
      go.disabled = false;
    }
  });
  return el('section', {},
    el('h1', {}, '정말 바꿀까요?'),
    el('div', { class: 'card' },
      el('p', { class: 'line-tight' }, '지금 기록 ' + cur.recordCount + '건이 사라지고 파일의 ' + p.info.recordCount + '건으로 바뀌어요.'),
      el('p', { class: 'note' }, '바꾼 뒤에도 [방금 가져오기 되돌리기]로 돌아갈 수 있어요. 지금 기록은 임시로 보관해 둬요.')),
    alertBox,
    el('a', { class: 'btn primary', href: '#/backup/import' }, '그만둘게요'),
    go,
  );
}

// 되돌리기 확인 질문
export async function backupUndoView(ctx) {
  const undo = await getUndoInfo(ctx.db);
  if (!undo) {
    return el('section', {},
      el('h1', {}, '되돌릴 불러오기가 없어요'),
      el('a', { class: 'btn primary', href: '#/backup' }, '돌아가기'));
  }
  const cur = await countCurrent(ctx.db);
  const alertBox = el('div', { class: 'alert', role: 'alert', hidden: true });
  const go = el('button', { type: 'button', class: 'btn danger' }, '되돌릴게요');
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      await undoImport(ctx.db);
      await refreshSettings(ctx);
      ctx.backupNotice = '불러오기 전의 기록으로 되돌렸어요.';
      location.hash = '#/backup';
    } catch (e) {
      console.error(e);
      alertBox.textContent = '되돌리지 못했어요. 기록은 그대로예요. 한 번 더 눌러 주세요.';
      alertBox.hidden = false;
      go.disabled = false;
    }
  });
  return el('section', {},
    el('h1', {}, '불러오기 전으로 되돌릴까요?'),
    el('div', { class: 'card' },
      el('p', { class: 'line-tight' }, '불러오기 전의 기록 ' + undo.recordCount + '건으로 돌아가요. 지금 기록은 ' + cur.recordCount + '건이에요.'),
      el('p', { class: 'note warn' }, '불러온 뒤에 새로 쓰신 기록은 사라져요.')),
    alertBox,
    el('a', { class: 'btn primary', href: '#/backup' }, '그만둘게요'),
    go,
  );
}

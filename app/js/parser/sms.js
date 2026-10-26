// 결제 문자 읽기 규칙 (가계부자)
// 기준 문서: 문자인식규칙_시니어가계부.md v1.0 (D37~D40)
// 앱 안의 규칙(패턴)으로만 읽는다. 서버·AI 호출 없음. 문자 원문은 저장하지 않는다(P3).
// 이 파일은 화면과 저장소를 모른다. 글자를 넣으면 읽은 결과만 돌려준다.

// 분류 id (defaults.js의 기본 분류와 같은 값)
const CAT_PENSION = 'i01';
const CAT_SALARY = 'i02';
const CAT_OTHER_INCOME = 'i03';

// 사람 이름 판별 보조(규칙 4번): 한글 3글자이고 흔한 성씨로 시작하면 "사람 이름일 수 있음"
// 이마트처럼 가게 이름도 걸릴 수 있어, 단정하지 않고 사용자에게 묻는 용도로만 쓴다.
const COMMON_SURNAMES = new Set(
  '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구나민진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉사부'.split('')
);

// 카드사 이름(규칙 4번). 영문은 대문자로 바꿔 비교한다.
const CARD_COMPANIES = [
  '삼성카드', '현대카드', '국민카드', 'KB국민', '신한카드', '롯데카드',
  '하나카드', '우리카드', 'BC카드', '농협카드', 'NH카드',
];

const RE_TAG = /^\[(Web발신|국외발신|국제발신)\]$/;
const RE_HEADER = /^신한\s*(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/;
const RE_KIND = /^(출금|입금)\s*([\d,]+)\s*원?/;
const RE_BALANCE = /^잔액\s*-?\s*[\d,]+/;
const RE_DIVIDER = /^\d{1,2}월\s*\d{1,2}일(\s*\S*요일)?$/;   // "10월 20일 화요일" 같은 날짜 구분줄

const pad = (n) => String(n).padStart(2, '0');

// 가맹점 이름 정리: 앞뒤 공백을 지우고 안의 여러 공백을 하나로 (학습 기록의 열쇠로도 쓴다)
export function normalizeMerchant(name) {
  return String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
}

export function isLikelyPersonName(name) {
  const n = normalizeMerchant(name);
  return /^[가-힣]{3}$/.test(n) && COMMON_SURNAMES.has(n[0]);
}

export function hasCardCompany(name) {
  const upper = normalizeMerchant(name).toUpperCase();
  return CARD_COMPANIES.some((c) => upper.includes(c.toUpperCase()));
}

// ---------- 1. 문자 나누기 (규칙 1) ----------
// "[Web발신]"을 기준으로 한 건씩 나눈다. 표시가 없으면 "신한 + 월/일 + 시:분"으로 시작하는 줄을 기준으로 나눈다.
export function splitMessages(text) {
  const source = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  if (/\[(Web발신|국외발신|국제발신)\]/.test(source)) {
    return source.split(/(?=\[(?:Web발신|국외발신|국제발신)\])/).filter((c) => c.trim() !== '');
  }
  const lines = source.split('\n');
  const chunks = [];
  let current = [];
  for (const line of lines) {
    if (RE_HEADER.test(line.trim()) && current.some((l) => RE_HEADER.test(l.trim()))) {
      chunks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks.filter((c) => c.trim() !== '');
}

// 군더더기(표시줄, 날짜 구분줄, 빈 줄)를 뺀 줄만 남긴다 (규칙 2)
function usefulLines(chunk) {
  return chunk.split('\n').map((l) => l.trim()).filter((l) => l && !RE_TAG.test(l) && !RE_DIVIDER.test(l));
}

// ---------- 날짜 (규칙 3) ----------
// 연도는 올해로 하되 오늘보다 미래 날짜가 되면 작년으로 한다.
function buildDate(month, day, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const year of [now.getFullYear(), now.getFullYear() - 1]) {
    const d = new Date(year, month - 1, day);
    const real = d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
    if (real && d <= today) return year + '-' + pad(month) + '-' + pad(day);
  }
  return '';
}

// ---------- 중복 확인용 해시 (규칙 6) ----------
// 정리한 글자(앞뒤 공백·줄바꿈·여러 공백을 하나로)의 해시만 저장한다.
export async function hashText(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  try {
    if (globalThis.crypto && crypto.subtle) {
      const bytes = new TextEncoder().encode(clean);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    }
  } catch (e) { /* 아래 간단한 방법으로 */ }
  // 보안 연결이 아닐 때를 대비한 간단한 대체 해시(FNV-1a). 중복 확인에만 쓴다.
  let h = 0x811c9dc5;
  for (let i = 0; i < clean.length; i++) { h ^= clean.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'f' + h.toString(16).padStart(8, '0');
}

// ---------- 범용 읽기 (다른 은행·카드 문자, 추정) ----------
// 은행 이름에 기대지 않고 "출금/입금/승인/결제 + 금액(원)" 같은 공통 표현만 본다.
// 추정이므로 결과에 generic: true를 달아 화면이 "확인해 주세요"를 더 강하게 보이게 한다.
// 읽지 못하면 reason(사유 코드)을 돌려준다: noAmount, noKind, cancel, notSms
const RE_AMOUNT_WON = /(-?[\d][\d,]*)\s*원/;
const RE_AMOUNT_AFTER = /(출금|입금|승인|결제|사용|이체)\s*:?\s*([\d][\d,]*)(?![\d,\/:.])\s*원?/;
const RE_MD = /(\d{1,2})\s*[\/.]\s*(\d{1,2})(?!\d)/;
const RE_KMD = /(\d{1,2})월\s*(\d{1,2})일/;
const RE_HM = /(\d{1,2}):(\d{2})/;
const RE_NOISE = /(잔액|누적|한도|일시불|할부|\*{2,}|\d{2,}-\d{2,}-|님$|고객|문의|☎|\d{2,4}-\d{3,4}-\d{4}|^\[.*\]$|http)/;

function parseGeneric(lines, chunk, now) {
  const text = lines.join(' ');
  if (/취소/.test(text)) return { ok: false, reason: 'cancel' };

  let kindWord = '', amount = 0;
  let m = RE_AMOUNT_AFTER.exec(text);
  if (m) { kindWord = m[1]; amount = Number(m[2].replace(/,/g, '')); }
  if (!kindWord) {
    const km = /(출금|입금|승인|결제)/.exec(text);
    if (km) kindWord = km[1];
  }
  if (!amount) {
    const am = RE_AMOUNT_WON.exec(text.replace(/잔액[^원]*원/g, ' '));
    if (am) amount = Number(am[1].replace(/[-,]/g, ''));
  }
  if (!Number.isInteger(amount) || amount < 1) {
    return { ok: false, reason: kindWord || /\d/.test(text) ? 'noAmount' : 'notSms' };
  }
  if (!kindWord) return { ok: false, reason: 'noKind' };

  const type = kindWord === '입금' ? 'income' : 'expense';

  let month = 0, day = 0, time = '';
  const dm = RE_MD.exec(text) || null;
  const km = RE_KMD.exec(text);
  if (km) { month = Number(km[1]); day = Number(km[2]); }
  else if (dm) { month = Number(dm[1]); day = Number(dm[2]); }
  const tm = RE_HM.exec(text);
  if (tm) time = pad(Number(tm[1])) + ':' + tm[2];
  const date = month ? buildDate(month, day, now) : '';

  // 가맹점: 군더더기·금액·날짜가 든 줄을 뺀 나머지 중 마지막 줄 (없으면 비워 둔다)
  const candidates = lines.filter((l) => !RE_NOISE.test(l) && !/\d{1,2}[\/.:]\d{1,2}/.test(l)
    && !/(출금|입금|승인|결제)/.test(l) && !RE_AMOUNT_WON.test(l) && !/^[\d\s,*\-]+$/.test(l));
  const merchant = candidates.length ? normalizeMerchant(candidates[candidates.length - 1]) : '';

  const missing = [];
  if (!date) missing.push('date');
  if (!merchant) missing.push('merchant');

  let ask = null, suggestedCategoryId = '';
  if (type === 'expense') {
    if (hasCardCompany(merchant)) ask = 'card';
    else if (isLikelyPersonName(merchant)) ask = 'person';
  } else {
    suggestedCategoryId = merchant.includes('연금') ? CAT_PENSION : merchant.includes('급여') ? CAT_SALARY : CAT_OTHER_INCOME;
    if (suggestedCategoryId === CAT_OTHER_INCOME && isLikelyPersonName(merchant)) ask = 'person';
  }
  return {
    ok: true, generic: true, type, date, time, amount, merchant, missing, ask, suggestedCategoryId,
    dedupeKey: null, duplicateInPaste: false, _lines: lines,
  };
}

// ---------- 한 건 읽기 (규칙 3~8) ----------
// 못 읽은 칸은 추측하지 않고 비워 두고 missing에 이름을 적는다.
// 금액이나 종류(출금/입금)를 못 읽으면 "읽지 못한 문자"(ok: false)다.
export async function parseMessage(chunk, now = new Date()) {
  const r = await parseMessageStrict(chunk, now);
  if (r.ok && r.generic) { r.dedupeKey = await hashText(r._lines.join(' ')); delete r._lines; }
  return r;
}

async function parseMessageStrict(chunk, now) {
  const lines = usefulLines(chunk);

  let month = 0, day = 0, time = '';
  let kind = '', amount = 0, kindIdx = -1, balanceIdx = -1;
  lines.forEach((line, i) => {
    let m;
    if (!month && (m = RE_HEADER.exec(line))) {
      month = Number(m[1]); day = Number(m[2]);
      time = pad(Number(m[3])) + ':' + m[4];
    } else if (kindIdx < 0 && (m = RE_KIND.exec(line))) {
      kind = m[1];
      amount = Number(m[2].replace(/,/g, ''));
      kindIdx = i;
    } else if (balanceIdx < 0 && RE_BALANCE.test(line)) {
      balanceIdx = i;     // 1차에서는 위치만 알아 두고 값은 저장·대조에 쓰지 않는다 (D40)
    }
  });

  if (!kind || !Number.isInteger(amount) || amount < 1) {
    return parseGeneric(lines, chunk, now);       // 신한 형식이 아니면 범용 규칙으로 한 번 더 읽어 본다
  }

  const date = month ? buildDate(month, day, now) : '';

  // 가맹점: 잔액 줄 다음 줄(없으면 금액 줄 다음 줄)의 글자를 그대로 쓴다 (규칙 7)
  const from = (balanceIdx >= 0 ? balanceIdx : kindIdx) + 1;
  let merchant = '';
  for (let i = from; i < lines.length; i++) {
    if (RE_HEADER.test(lines[i]) || RE_KIND.test(lines[i]) || RE_BALANCE.test(lines[i])) continue;
    merchant = normalizeMerchant(lines[i]);
    break;
  }

  const missing = [];
  if (!date) missing.push('date');
  if (!merchant) missing.push('merchant');

  const type = kind === '출금' ? 'expense' : 'income';

  // 판단 보조(규칙 4): 미리 채울 기본값과 묻는 질문. 최종 결정은 사용자가 한다.
  let ask = null;
  let suggestedCategoryId = '';
  if (type === 'expense') {
    if (hasCardCompany(merchant)) ask = 'card';
    else if (isLikelyPersonName(merchant)) ask = 'person';
  } else {
    if (merchant.includes('연금')) suggestedCategoryId = CAT_PENSION;
    else if (merchant.includes('급여')) suggestedCategoryId = CAT_SALARY;
    else suggestedCategoryId = CAT_OTHER_INCOME;
    if (suggestedCategoryId === CAT_OTHER_INCOME && isLikelyPersonName(merchant)) ask = 'person';
  }

  const dedupeKey = await hashText(lines.join(' '));

  return {
    ok: true,
    type,
    date,
    time,
    amount,
    merchant,
    missing,
    ask,
    suggestedCategoryId,
    dedupeKey,
    duplicateInPaste: false,
  };
}

// ---------- 붙여넣은 글 전체 읽기 ----------
// 돌려주는 값: { items: [읽은 결과 또는 { ok:false }], readable: 읽은 건수, unreadable: 못 읽은 건수 }
export async function parseSms(text, now = new Date()) {
  const items = [];
  const seen = new Set();
  for (const chunk of splitMessages(text)) {
    if (usefulLines(chunk).length === 0) continue;       // 구분줄만 있는 덩어리는 버린다
    const item = await parseMessage(chunk, now);
    if (item.ok) {
      if (seen.has(item.dedupeKey)) item.duplicateInPaste = true;   // 같은 글을 한 번에 두 번 붙임
      seen.add(item.dedupeKey);
    }
    items.push(item);
  }
  const readable = items.filter((i) => i.ok).length;
  return { items, readable, unreadable: items.length - readable };
}

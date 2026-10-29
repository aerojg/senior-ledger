/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 문자 읽기 규칙 시험 목록 (개발용)
// 시험 화면(parser-test.html)과 컴퓨터 안의 자동 시험이 같은 목록을 쓴다.
// 모든 문자는 가짜 값이다 (규칙 7: 실제 이름·계좌·잔액 사용 금지).
import { parseSms, splitMessages, hashText, normalizeMerchant, isLikelyPersonName } from '../js/parser/sms.js';

// 문자 한 건을 만드는 도우미: 가짜 계좌번호와 가짜 잔액을 쓴다
function sms({ md = '10/20', hm = '14:26', kind = '출금', amount = '1,000', balance = '18,000,000', merchant = ' 가나다-세외', tag = true } = {}) {
  const lines = [];
  if (tag) lines.push('[Web발신]');
  lines.push('신한' + md + ' ' + hm, '110-***-123456');
  if (amount !== null) lines.push(kind + ' ' + amount);
  lines.push('잔액-' + balance);
  if (merchant !== null) lines.push(merchant);
  return lines.join('\n');
}

const NOW = new Date(2026, 9, 23);      // 2026-10-23 (규칙 7의 기준일)

export async function runParserTests() {
  const results = [];
  const check = (label, pass, detail = '') => results.push({ label, pass: !!pass, detail });
  const eq = (label, actual, expected) =>
    check(label, actual === expected, '"' + actual + '"' + (actual === expected ? '' : ' ← 정답 "' + expected + '"'));
  const one = async (text, now = NOW) => (await parseSms(text, now)).items[0];

  // ---- 문서의 샘플 S01~S12 ----
  let r = await one(sms());
  check('S01 읽기 성공', r.ok);
  eq('S01 종류', r.type, 'expense');
  eq('S01 금액', r.amount, 1000);
  eq('S01 가맹점(앞 공백 제거)', r.merchant, '가나다-세외');
  eq('S01 날짜', r.date, '2026-10-20');
  eq('S01 시각', r.time, '14:26');
  eq('S01 분류는 비워 둠', r.suggestedCategoryId, '');
  eq('S01 질문 없음', r.ask, null);
  check('S01 못 읽은 칸 없음', r.missing.length === 0);

  r = await one(sms({ amount: '10,020', merchant: ' 마트다라 스' }));
  eq('S02 금액', r.amount, 10020);
  eq('S02 가맹점은 잘린 그대로', r.merchant, '마트다라 스');

  r = await one(sms({ kind: '입금', amount: '50', merchant: ' 현금IC캐시백' }));
  eq('S03 종류', r.type, 'income');
  eq('S03 금액', r.amount, 50);
  eq('S03 분류 기타소득', r.suggestedCategoryId, 'i03');

  r = await one(sms({ amount: '100,000', merchant: ' 김가나' }));
  eq('S04 이체 질문(사람 이름)', r.ask, 'person');
  eq('S04 종류는 지출 후보', r.type, 'expense');

  r = await one(sms({ amount: '350,000', merchant: ' 삼성카드' }));
  eq('S05 카드값 질문', r.ask, 'card');

  r = await one(sms({ kind: '입금', amount: '1,350,000', merchant: ' 국민연금' }));
  eq('S06 수입 후보', r.type, 'income');
  eq('S06 분류 연금소득', r.suggestedCategoryId, 'i01');
  eq('S06 질문 없음', r.ask, null);

  r = await one(sms({ kind: '입금', amount: '2,500,000', merchant: ' 급여' }));
  eq('S07 분류 급여소득', r.suggestedCategoryId, 'i02');

  r = await one(sms({ md: '12/31', hm: '23:59' }), new Date(2027, 0, 2));
  eq('S08 오늘이 1월 2일이면 12/31은 작년', r.date, '2026-12-31');
  r = await one(sms({ md: '12/31', hm: '23:59' }), new Date(2026, 11, 31));
  eq('S08 같은 해 12/31(오늘)은 올해', r.date, '2026-12-31');

  const first = await one(sms());
  const twice = await parseSms(sms() + '\n' + sms());
  check('S09 같은 글을 두 번 붙이면 두 번째는 중복 표시', twice.items.length === 2 && !twice.items[0].duplicateInPaste && twice.items[1].duplicateInPaste);
  eq('S09 해시가 같다', twice.items[1].dedupeKey, first.dedupeKey);
  const noTag = await one(sms({ tag: false }));
  eq('S09 [Web발신] 표시가 없어도 같은 문자로 본다', noTag.dedupeKey, first.dedupeKey);
  const other = await one(sms({ balance: '17,999,000' }));
  check('S09 잔액이 다르면 다른 문자로 구분한다', other.dedupeKey !== first.dedupeKey);

  const two = await parseSms(
    '10월 20일 화요일\n' + sms({ merchant: ' 가나다-세외' }) + '\n10월 21일 수요일\n' + sms({ md: '10/21', amount: '2,000', merchant: ' 마트다라 스' }));
  check('S10 두 건으로 나뉘고 구분줄은 버려진다', two.items.length === 2 && two.readable === 2, 'items=' + two.items.length);
  eq('S10 첫 건 금액', two.items[0].amount, 1000);
  eq('S10 둘째 건 금액', two.items[1].amount, 2000);

  const broken = await parseSms(sms({ amount: null }));
  check('S11 금액 줄이 없으면 읽지 못함', broken.items.length === 1 && !broken.items[0].ok && broken.unreadable === 1);

  r = await one(sms({ amount: '5,000', merchant: ' 이마트' }));
  eq('S12 이마트도 이체 질문이 뜬다(알려진 한계)', r.ask, 'person');

  // ---- 경계 시험 ----
  const noTagTwo = await parseSms(sms({ tag: false }) + '\n' + sms({ tag: false, md: '10/21', amount: '3,000' }));
  check('표시가 없어도 "신한 월/일 시:분" 줄로 나눈다', noTagTwo.items.length === 2 && noTagTwo.readable === 2, 'items=' + noTagTwo.items.length);

  r = await one(sms({ amount: '12,300원' }));
  eq('금액 뒤에 "원"이 붙어도 읽는다', r.amount, 12300);

  r = await one(sms({ md: '02/30' }));
  check('없는 날짜(2/30)는 비워 두고 확인을 요청한다', r.ok && r.date === '' && r.missing.includes('date'), 'date="' + r.date + '"');

  r = await one(sms({ merchant: null }));
  check('가맹점이 없으면 비워 두고 확인을 요청한다', r.ok && r.merchant === '' && r.missing.includes('merchant'));

  const garbage = await parseSms('안녕하세요 오늘 점심 뭐 드셨어요');
  check('문자가 아닌 글은 읽지 못함 1건', garbage.items.length === 1 && garbage.unreadable === 1);
  const empty = await parseSms('   \n  ');
  check('빈 글은 0건', empty.items.length === 0);
  const onlyDivider = await parseSms('10월 20일 화요일');
  check('구분줄만 있으면 0건', onlyDivider.items.length === 0);

  r = await one(sms({ kind: '입금', amount: '30,000', merchant: ' 박가나' }));
  eq('입금 + 사람 이름은 이체 여부를 묻는다', r.ask, 'person');
  eq('입금 + 사람 이름의 기본 분류는 기타소득', r.suggestedCategoryId, 'i03');

  r = await one(sms({ amount: '88,000', merchant: ' KB국민카드' }));
  eq('카드사 이름(KB국민)도 카드값 질문', r.ask, 'card');
  r = await one(sms({ amount: '88,000', merchant: ' nh카드' }));
  eq('카드사 이름은 대소문자를 가리지 않는다', r.ask, 'card');

  check('성씨가 아닌 3글자는 사람 이름으로 보지 않는다', !isLikelyPersonName('가나다') && isLikelyPersonName('김가나') && !isLikelyPersonName('김가'));
  eq('가맹점 이름 정리(여러 공백)', normalizeMerchant('  마트   다라  '), '마트 다라');
  check('해시는 같은 글이면 같고 다르면 다르다',
    (await hashText('a  b\nc')) === (await hashText('a b c')) && (await hashText('a')) !== (await hashText('b')));
  check('나누기: 표시 두 개는 두 덩어리', splitMessages('[Web발신]\nA\n[Web발신]\nB').length === 2);


  // ---- 다른 은행·카드 문자 범용 읽기 (가짜 값, 추정 형식) ----
  r = await one('[Web발신]\n[가나다카드] 승인\n홍*동 12,300원 일시불\n10/22 13:05\n마트다라');
  check('G01 카드 승인 문자를 읽는다', r.ok && r.generic && r.type === 'expense' && r.amount === 12300, JSON.stringify(r));
  eq('G01 가맹점', r.merchant, '마트다라');
  eq('G01 날짜', r.date, '2026-10-22');
  r = await one('[Web발신]\n[가나은행]10/22 09:10\n123-45**-678\n입금 50,000원\n잔액 1,000,000원\n급여');
  check('G02 다른 은행 입금 문자를 읽는다', r.ok && r.type === 'income' && r.amount === 50000, JSON.stringify(r));
  eq('G02 급여 분류', r.suggestedCategoryId, 'i02');
  r = await one('[Web발신]\n[가나카드] 승인취소 12,300원\n10/22 마트다라');
  check('G03 취소 문자는 사유 cancel로 읽지 못함', !r.ok && r.reason === 'cancel');
  r = await one('[Web발신]\n가나은행 출금\n10/22 14:00');
  check('G04 금액이 없으면 사유 noAmount', !r.ok && r.reason === 'noAmount', JSON.stringify(r));
  r = await one('안녕하세요 오늘 점심 뭐 드셨어요');
  check('G05 문자가 아니면 사유 notSms', !r.ok && r.reason === 'notSms');
  r = await one(sms());
  check('G06 신한 형식은 범용이 아니라 정확한 규칙으로 읽는다', r.ok && !r.generic);

  return results;
}

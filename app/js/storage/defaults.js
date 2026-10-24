// 기본 분류와 기본 설정 (데이터구조_시니어가계부.md v1.0, 3-2 / 3-10)
// 화면 순서(order)는 화면흐름 v1.0의 5번 "분류 버튼 표시안"을 따른다.
// 앞의 6개: 식비, 생활용품, 건강·병원·약, 교통, 차량유지비, 여가·여행·취미

export const DEFAULT_CATEGORIES = [
  // id, 이름, 종류, 기본 비용 유형, 기본 필수 여부, 화면 순서
  ['c01', '식비',           'expense', 'variable', false, 1],
  ['c13', '생활용품',       'expense', 'variable', false, 2],
  ['c02', '건강·병원·약',   'expense', 'variable', true,  3],
  ['c03', '교통',           'expense', 'variable', false, 4],
  ['c04', '차량유지비',     'expense', 'variable', false, 5],
  ['c12', '여가·여행·취미', 'expense', 'variable', false, 6],
  ['c05', '주거·공과금',    'expense', 'fixed',    true,  7],
  ['c06', '통신',           'expense', 'fixed',    true,  8],
  ['c07', '보험',           'expense', 'fixed',    true,  9],
  ['c08', '구독·정기결제',  'expense', 'fixed',    false, 10],
  ['c09', '모임회비',       'expense', 'fixed',    false, 11],
  ['c10', '경조사',         'expense', 'oneoff',   true,  12],
  ['c11', '가족·손주',      'expense', 'variable', false, 13],
  ['c14', '기타',           'expense', 'variable', false, 14],
  // 수입 분류
  ['i01', '연금',           'income',  'fixed',    false, 101],
  ['i02', '급여·소득',      'income',  'fixed',    false, 102],
  ['i03', '기타 수입',      'income',  'oneoff',   false, 103],
].map(([id, name, kind, costTypeDefault, essentialDefault, order]) => ({
  id, name, kind, costTypeDefault, essentialDefault, order,
  isActive: true,
  isUserDefined: false,
}));

export function makeDefaultSettings() {
  return {
    key: 'main',
    coachStyle: 'neighbor',   // 다정한 이웃형(기본). 설정에서 바꾼다(D44)
    showCheer: true,          // 한 줄 응원 보이기(D43)
    soundOn: false,           // 소리는 처음에 끔(U10)
    animationOn: false,       // 움직임도 처음에 끔(U10)
    fontScale: 1,             // 글씨 크기 배율(3단계는 화면 구현 때 정함)
    monthStartDay: 1,         // 한 달 시작일 1~28
    retirement: null,         // 5단계에서 확정
    entitlements: { all: true }, // 기능 등급 자리(P9), 지금은 모두 허용
    onboardingDone: false,
  };
}

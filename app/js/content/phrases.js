/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 말풀이 문구 원본 (말풀이틀_시니어가계부.md v1.0의 4번: 상황 × 코치 3종 × 변형)
// 문구만 고쳐도 앱 코드는 바꾸지 않는다. 숫자와 사실은 세 코치가 같고 앞뒤 분위기만 다르다.
// 규칙: 쉬운 우리말, 한 줄 한 문장, 나무라거나 비교하는 말 금지, 필수 지출에는 농담·칭찬·경고 없음.
// 변수: {월} 등은 pickPhrase의 vars로 채운다.

export const COACHES = ['neighbor', 'captain', 'secretary'];   // 다정한 이웃형, 유쾌한 반장님형, 담담한 비서형

export const PHRASES = {
  // 월 결산 첫 인사
  settleHello: {
    neighbor: ['{월}월 살림을 함께 살펴봐요.', '{월}월 이야기를 차분히 들려 드릴게요.'],
    captain: ['{월}월 결산 시작합니다!', '자, {월}월 살림 점검 들어갑니다!'],
    secretary: ['{월}월 결산입니다.', '{월}월 지출 현황을 정리했습니다.'],
  },
  // 월 균형 신호 한 줄 (월이 끝난 뒤에만 쓴다)
  balanceGreen: {
    neighbor: ['여유 있게 보내셨어요. 잘하셨어요.', '이번 달은 마음이 놓이는 살림이었어요.'],
    captain: ['여유 만점입니다! 박수 짝짝!', '수입보다 훨씬 덜 쓰셨습니다!'],
    secretary: ['수입 대비 지출은 여유 있는 수준입니다.', '지출이 수입의 90% 이하입니다.'],
  },
  balanceYellow: {
    neighbor: ['조금 빠듯했어요. 다음 달엔 천천히 살펴봐요.', '수입에 가깝게 쓰셨어요. 그래도 잘 버티셨어요.'],
    captain: ['빠듯했습니다! 다음 달 힘내 봅시다!', '아슬아슬했습니다! 다음 달엔 여유를 만들어 봐요!'],
    secretary: ['지출이 수입에 가까웠습니다.', '지출이 수입의 90%를 넘었습니다.'],
  },
  balanceRed: {
    neighbor: ['수입보다 조금 더 쓴 달이었어요. 다음 달에 같이 살펴봐요.', '이번 달은 쓸 일이 많았나 봐요. 괜찮아요.'],
    captain: ['이번 달은 지출이 컸습니다! 다음 달에 만회해 봐요!', '수입보다 더 썼습니다! 다음 달을 노려 봐요!'],
    secretary: ['지출이 수입보다 많았습니다.', '수입을 넘는 지출이 있었습니다.'],
  },
  balanceNone: {
    neighbor: ['수입을 기록하면 균형을 볼 수 있어요.'],
    captain: ['수입을 기록하면 균형을 볼 수 있습니다!'],
    secretary: ['수입을 기록하면 균형을 계산할 수 있습니다.'],
  },
  // 진행 중인 달 (신호등을 칠하지 않는다, D42)
  settleRunning: {
    neighbor: ['아직 이번 달이 끝나지 않았어요. 지금까지의 금액만 보여 드려요.'],
    captain: ['이번 달은 아직 진행 중입니다! 지금까지의 금액만 보여 드려요!'],
    secretary: ['이번 달은 진행 중입니다. 지금까지의 금액입니다.'],
  },
  // 늘어난 항목이 없을 때
  risingNone: {
    neighbor: ['평소보다 크게 늘어난 항목은 없어요.', '크게 달라진 항목 없이 차분한 달이었어요.'],
    captain: ['크게 늘어난 항목은 없습니다! 안정적입니다!', '평소와 비슷하게 잘 지내셨습니다!'],
    secretary: ['크게 늘어난 항목은 없습니다.', '평소 대비 큰 변동이 없습니다.'],
  },
  // 첫 달이라 비교할 기준이 없을 때
  baselineBuilding: {
    neighbor: ['평소 기준을 만드는 중이에요. 다음 달부터 비교해 드릴게요.'],
    captain: ['평소 기준을 만드는 중입니다! 다음 달부터 비교해 드릴게요!'],
    secretary: ['평소 기준을 만드는 중입니다. 다음 달부터 비교합니다.'],
  },
};

function hashText(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// 같은 달·같은 상황에서는 늘 같은 문구가 나오도록 seed로 고른다 (화면을 다시 열 때마다 바뀌지 않게)
export function pickPhrase(situation, coach, vars = {}, seed = '') {
  const group = PHRASES[situation];
  if (!group) return '';
  const list = group[COACHES.includes(coach) ? coach : 'neighbor'];
  const text = list[hashText(situation + '|' + seed) % list.length];
  return text.replace(/\{(.+?)\}/g, (m, name) => (vars[name] != null ? String(vars[name]) : m));
}

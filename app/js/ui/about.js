// 앱 정보와 개인정보 요약, 사용 방법 (S11 아래)
// 개인정보 처리방침 전체 문서는 별도 공개 페이지로 만든다(완료 정의 ④). 여기에는 요약만 둔다.
import { el } from './dom.js';
import { APP_VERSION } from '../storage/backup.js';

function kv(label, value) {
  return el('div', { class: 'kv-item' }, el('p', { class: 'kicker' }, label), el('p', { class: 'kv-value' }, value));
}

export async function aboutView() {
  return el('section', {},
    el('h1', {}, '앱 정보'),
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, '이 앱은'),
      kv('이름', '가계부자'),
      kv('버전', APP_VERSION),
      kv('하는 일', '쓴 돈을 적고, 한 달부터 1년까지 돌아보고, 저금통에 모으는 일을 도와요.')),
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, '내 기록과 개인정보'),
      kv('저장하는 곳', '내 기록은 이 휴대폰 안에만 저장돼요.'),
      kv('밖으로 보내나요?', '아니요. 로그인도 없고, 기록을 서버로 보내지 않아요.'),
      kv('결제 문자', '붙여 넣은 문자 원문은 저장하지 않아요. 읽은 결과만 저장해요.'),
      kv('파일로 저장하면', '"내 기록 저장하기"로 만든 파일에는 가계 기록이 들어 있어요. 남에게 보내지 마세요.'),
      el('p', { class: 'note' }, '개인정보 처리방침 전체 글은 따로 공개할 준비를 하고 있어요.')),
    el('div', { class: 'card' },
      el('h2', { class: 'card-title' }, '사용 방법'),
      el('p', { class: 'kv-value' }, '안내 영상은 준비 중이에요.'),
      el('p', { class: 'note' }, '처음 안내 화면은 더보기의 "앱 소개 다시 보기"에서 다시 볼 수 있어요.')),
    el('a', { class: 'btn', href: '#/more' }, '더보기로'));
}

/* Copyright (c) 2026 aerojg. All rights reserved. See LICENSE. */
// 작은 효과: 기록을 마쳤을 때의 동전 소리와 살짝 움직이는 표시 (U10, Q41).
// 소리는 파일 없이 앱이 직접 만든다(저작권·용량 부담 없음). 둘 다 설정에서 끌 수 있고 기본은 꺼져 있다.
// 폰의 "움직임 줄이기"가 켜져 있으면 설정과 관계없이 움직이지 않는다. 어떤 효과도 실패해도 화면은 그대로 이어진다.

export function motionAllowed(settings) {
  if (!settings || !settings.animationOn) return false;
  try {
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) {
    return true;
  }
}

// 표시 하나를 한 번 살짝 키웠다 돌아오게 한다(CSS .pop)
export function popOnce(node, settings) {
  if (!node || !motionAllowed(settings)) return false;
  node.classList.add('pop');
  node.addEventListener('animationend', () => node.classList.remove('pop'), { once: true });
  return true;
}

let audio = null;

// 짧은 동전 소리(높은 두 음, 합쳐서 0.3초 안쪽, 작은 소리)
export function playCoin(settings) {
  if (!settings || !settings.soundOn) return false;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!audio) audio = new AC();
    if (audio.state === 'suspended') audio.resume();
    const t0 = audio.currentTime;
    [[988, 0], [1319, 0.09]].forEach(([hz, delay]) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, t0 + delay);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.16);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + 0.18);
    });
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

// 기록 완료 화면(S5)이 열린 직후 한 번: ✓ 표시와 오늘 도장이 살짝 움직이고 동전 소리가 난다
export function recordEffects(settings, root) {
  try {
    if (root) {
      popOnce(root.querySelector('.check'), settings);
      popOnce(root.querySelector('.stamp-cell.today.on .stamp-mark'), settings);
    }
    playCoin(settings);
  } catch (e) { console.error(e); }
}

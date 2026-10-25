// 화면 모양 설정을 앱에 적용한다 (글씨 크기 배율 등)
export function applyFontScale(scale) {
  document.documentElement.style.setProperty('--scale', String(scale || 1));
}

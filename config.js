// ===== 설정 =====
// Firebase 설정을 넣으면 모든 사용자가 평가/코멘트를 함께 보게 됩니다.
// 비워두면(null) 브라우저(localStorage)에만 저장됩니다.
//
// Firebase 콘솔 → 프로젝트 설정 → 내 앱 → SDK 설정 및 구성 에서 복사하세요.
export const FIREBASE_CONFIG = null;
/*
export const FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
*/

// 지나온 길 선 색상
export const TRAIL_COLOR = "#f97316";

// 정확도가 이 값(m)보다 나쁘면 경로에 추가하지 않음
export const MAX_ACCURACY_M = 40;

// 이 거리(m) 이상 움직였을 때만 경로에 점 추가 (GPS 떨림 방지)
export const MIN_STEP_M = 3;

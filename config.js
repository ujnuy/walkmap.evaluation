// ===== 설정 =====
// Firebase 설정을 넣으면 모든 사용자가 평가/코멘트를 함께 보게 됩니다.
// null 로 바꾸면 브라우저(localStorage)에만 저장됩니다.
// (이 값들은 공개되어도 되는 값이에요. 보안은 Firestore 규칙으로 지킵니다.)
//
// Firebase 콘솔 → 프로젝트 설정 → 내 앱 → SDK 설정 및 구성 에서 복사하세요.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBYO8rozJBMJGxtxon6bk_lEpYiedNAc5k",
  authDomain: "walkmap-a04fb.firebaseapp.com",
  projectId: "walkmap-a04fb",
  storageBucket: "walkmap-a04fb.firebasestorage.app",
  messagingSenderId: "238535497314",
  appId: "1:238535497314:web:439a7668bba2edb171e33b",
};

// 지나온 길 선 색상
export const TRAIL_COLOR = "#f97316";

// 정확도가 이 값(m)보다 나쁘면 경로에 추가하지 않음
export const MAX_ACCURACY_M = 40;

// 이 거리(m) 이상 움직였을 때만 경로에 점 추가 (GPS 떨림 방지)
export const MIN_STEP_M = 3;

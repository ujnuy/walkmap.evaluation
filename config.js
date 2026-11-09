// 앱 설정 파일입니다.
// 다른 사람의 평가도 함께 보려면 Firebase 프로젝트를 만들고
// 아래 firebase 값을 채워 넣으세요. (방법은 README.md 참고)
// 비워두면 평가는 이 기기(브라우저)에만 저장됩니다.

window.CONFIG = {
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: ""
  },

  // 처음 지도를 열 때 위치 (대구 동성로 근처)
  startCenter: [35.8695, 128.5960],
  startZoom: 17,

  // ?demo 로 열었을 때 캐릭터가 걷는 위치 (서울시청 근처)
  demoCenter: [37.5663, 126.9779],

  // 길 이름을 다시 찾는 간격
  geocodeEverySeconds: 15,
  geocodeEveryMeters: 30
};

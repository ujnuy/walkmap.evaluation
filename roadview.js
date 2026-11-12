// 카카오 로드뷰
// - KAKAO_JS_KEY 가 있으면: 카카오 지도 SDK로 앱 안에 로드뷰를 띄움
// - 없으면: 카카오맵 로드뷰 링크(새 탭/카카오맵 앱)로 연결
// 카카오 JavaScript 키는 웹페이지에 공개되는 키예요. 대신 카카오 개발자 콘솔에 등록한 도메인에서만 동작해요.

export function roadviewLink(lat, lng) {
  return `https://map.kakao.com/link/roadview/${lat.toFixed(6)},${lng.toFixed(6)}`;
}

let sdkPromise = null;
/** 카카오 지도 SDK를 한 번만 불러옴 */
export function loadKakaoSdk(appKey) {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("카카오 지도 SDK 응답이 없어요")), 10000);
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    s.onload = () => {
      if (!window.kakao?.maps?.load) {
        clearTimeout(timer);
        // 도메인이 등록되지 않았거나 키가 틀리면 SDK가 비어 있음
        return reject(new Error("카카오 지도 SDK를 쓸 수 없어요 (키·도메인 설정 확인)"));
      }
      window.kakao.maps.load(() => { clearTimeout(timer); resolve(window.kakao); });
    };
    s.onerror = () => { clearTimeout(timer); reject(new Error("카카오 지도 SDK를 불러오지 못했어요")); };
    document.head.append(s);
  });
  sdkPromise.catch(() => { sdkPromise = null; }); // 실패하면 다음에 다시 시도
  return sdkPromise;
}

/**
 * 로드뷰 뷰어 만들기
 * @param kakao   loadKakaoSdk 결과
 * @param el      로드뷰를 그릴 요소 (크기가 있어야 함)
 * @param onMove  (lat, lng) => void  — 로드뷰 안에서 이동했을 때
 */
export function createRoadview(kakao, el, onMove) {
  const rv = new kakao.maps.Roadview(el);
  const client = new kakao.maps.RoadviewClient();
  let moveTimer = null;

  kakao.maps.event.addListener(rv, "position_changed", () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const p = rv.getPosition();
      if (p) onMove(p.getLat(), p.getLng());
    }, 250);
  });

  const nearest = (pos, radius) =>
    new Promise((resolve) => client.getNearestPanoId(pos, radius, (id) => resolve(id)));

  return {
    /** lat,lng 근처(50m → 200m) 로드뷰를 띄움. 없으면 false */
    async show(lat, lng) {
      const pos = new kakao.maps.LatLng(lat, lng);
      const id = (await nearest(pos, 50)) ?? (await nearest(pos, 200));
      if (id === null || id === undefined) return false;
      rv.setPanoId(id, pos);
      return true;
    },
    relayout() { rv.relayout(); },
  };
}

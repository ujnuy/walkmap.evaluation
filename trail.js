// 날짜별 "지나온 길" 도우미 (지도/저장소와 무관한 순수 함수들)
// 점 하나 = [위도, 경도, 시각(초)]. 예전 버전 기록은 시각이 없어서 0.

export const LEGACY_DAY = "legacy";        // 날짜 정보가 없는 예전 기록
export const MAX_DAYS = 60;                // 최근 60일만 보관
export const MAX_POINTS_PER_DAY = 20000;   // Firestore 문서 1MB 제한 안쪽
const BREAK_GAP_SEC = 10 * 60;             // 10분 넘게 끊기면 선을 나눔
const BREAK_DIST_M = 300;                  // 한 번에 300m 넘게 튀면 선을 나눔

const pad = (n) => String(n).padStart(2, "0");

/** 이 기기 시간대 기준 날짜 키 "YYYY-MM-DD" */
export function dayKey(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDayKey(k) {
  return k === LEGACY_DAY || /^\d{4}-\d{2}-\d{2}$/.test(k);
}

/** [[lat,lng,t],…] → [lat,lng,t,lat,lng,t,…] (Firestore는 2차원 배열을 못 씀) */
export function flatten(points) {
  const out = [];
  for (const [lat, lng, t] of points) out.push(+lat.toFixed(6), +lng.toFixed(6), t | 0);
  return out;
}

export function unflatten(flat) {
  const out = [];
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const lat = Number(flat[i]), lng = Number(flat[i + 1]), t = Number(flat[i + 2]) || 0;
    if (Number.isFinite(lat) && Number.isFinite(lng)) out.push([lat, lng, t]);
  }
  return out;
}

/** 두 점 사이 거리(m) */
export function distance(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 이전 점과 이어 그리면 안 되는지 (오래 끊겼거나 순간이동) */
export function isBreak(prev, cur) {
  if (!prev) return true;
  if (prev[2] && cur[2] && cur[2] - prev[2] > BREAK_GAP_SEC) return true;
  return distance(prev, cur) > BREAK_DIST_M;
}

/** 지도에 그릴 선 조각들: [[[lat,lng],…], …] */
export function segments(points) {
  const segs = [];
  let cur = null;
  points.forEach((p, i) => {
    if (!cur || isBreak(points[i - 1], p)) segs.push((cur = []));
    cur.push([p[0], p[1]]);
  });
  return segs;
}

/** 하루 요약: 거리(선 조각 안에서만 합산), 시작/끝 시각, 점 개수 */
export function dayStats(points) {
  let dist = 0;
  for (let i = 1; i < points.length; i++) {
    if (!isBreak(points[i - 1], points[i])) dist += distance(points[i - 1], points[i]);
  }
  const times = points.map((p) => p[2]).filter(Boolean);
  return {
    distance: dist,
    start: times.length ? Math.min(...times) : null,
    end: times.length ? Math.max(...times) : null,
    count: points.length,
  };
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
export function formatDay(key) {
  if (key === LEGACY_DAY) return "이전 기록 (날짜 정보 없음)";
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const thisYear = new Date().getFullYear();
  return `${y !== thisYear ? `${y}년 ` : ""}${m}월 ${d}일 (${WEEK[date.getDay()]})`;
}

export function formatKm(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`;
}

export function formatClock(sec) {
  return new Date(sec * 1000).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
}

/** 날짜 키 정렬: 최신 날짜 먼저, 날짜 없는 예전 기록은 맨 뒤 */
export function sortDaysDesc(keys) {
  return [...keys].sort((a, b) => (a === LEGACY_DAY ? 1 : b === LEGACY_DAY ? -1 : b.localeCompare(a)));
}

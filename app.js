import { TRAIL_COLOR, MAX_ACCURACY_M, MIN_STEP_M, POOR_ACCURACY_M } from "./config.js?v=202611102349";
import * as T from "./trail.js?v=202611102349";
import { createBackend } from "./backend.js?v=202611102349";
import { walkerHtml, previewSvg, HAIRS, SKINS, OUTFITS, normalizeCharacter } from "./sprite.js?v=202611102349";

const $ = (id) => document.getElementById(id);
const DEMO = new URLSearchParams(location.search).has("demo");
const CHAR_KEY = "walkmap.character";
const OLD_GENDER_KEY = "walkmap.gender"; // 예전 버전(여/남) 설정
const GUEST_TRAIL_KEY = "walkmap.trail.guest"; // 예전 형식(날짜 없음) — 정리용
const GUEST_DAYS_KEY = "walkmap.days.guest";   // 게스트: 이 탭에서만 (닫으면 사라짐)
const GUEST_MINE_KEY = "walkmap.guest.mine";

// ===================== 상태 =====================
// 게스트의 "내가 쓴 글" 목록과 경로는 sessionStorage 에만 둡니다.
// → 탭/사이트를 닫으면 사라져서, 다시 와도 내가 쓴 글인지 알 수 없어요.
// 로그인 사용자는 authorId 로 글이 연결되고, 경로는 Firestore(users/{uid})에 백업됩니다.
const state = {
  started: false,
  user: null,            // { uid, name } | null(게스트)
  character: normalizeCharacter(readJSON(localStorage, CHAR_KEY, null) ?? readLocal(OLD_GENDER_KEY)),
  guestMine: new Set(readJSON(sessionStorage, GUEST_MINE_KEY, [])),
  reviews: [],
  rating: null,
  photo: null,           // 압축된 dataURL
  gpsRoad: "",           // 내 위치(GPS)의 길 이름
  gpsPlace: null,        // { road, area, dong, houseNumber } (민원 문안용 주소)
  freePlace: null,
  free: false,           // 자유모드: 지도를 움직여 원하는 길을 평가
  freeTarget: null,      // 자유모드에서 십자 표시가 가리키는 위치
  freeRoad: "",
  freeLoading: false,
  lastAccuracy: null,
  current: null,
  facingLeft: false,
  lastMoveAt: 0,
  follow: true,
};

const backend = await createBackend();

// ===================== 지도 =====================
// 시작 위치는 GPS로 찾은 현재 위치. 찾기 전까지는 한반도 전체를 보여줌.
const map = L.map("map", { zoomControl: false }).setView([36.4, 127.8], 7);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

// 날짜별 지나온 길: days["YYYY-MM-DD"] = [[lat, lng, 시각(초)], …]. 지도에는 오늘 것만 그림.
let days = {};
let todayKey = T.dayKey();
let trail = [];            // = days[todayKey]
const trailLine = L.polyline([], { color: TRAIL_COLOR, weight: 7, opacity: 0.85, lineCap: "round" }).addTo(map);
const reviewLayer = L.layerGroup().addTo(map);
let walker = null;
let accuracyCircle = null;

const makeWalkerIcon = () =>
  L.divIcon({ className: "walker", html: walkerHtml(state.character), iconSize: [36, 48], iconAnchor: [18, 46] });

// ===================== 시작 화면: 로그인 / 게스트 택1 =====================
$("startWalker").innerHTML = walkerHtml(state.character, 4);

if (!backend.canLogin) {
  $("btnLogin").disabled = true;
  $("loginNote").textContent = "※ 로그인은 config.js 에 Firebase 설정을 넣어야 사용할 수 있어요 (README 참고).";
}

let loginClicked = false;
$("btnLogin").addEventListener("click", async () => {
  // Google은 앱 안 브라우저(카카오톡·인스타그램 등)에서 로그인을 막음 → 외부 브라우저로 안내
  if (IN_APP) {
    if (canOpenExternal()) {
      if (confirm(`${IN_APP.name} 안에서는 Google 로그인이 되지 않아요.\n브라우저로 열어서 로그인할까요?`)) openExternal();
    } else {
      alert(`${IN_APP.name} 안에서는 Google 로그인이 되지 않아요.\n${openExternalGuide()}`);
    }
    return;
  }
  loginClicked = true;
  try {
    const ok = await backend.signIn(); // 성공하면 onAuth 에서 이어짐
    if (ok === false) loginClicked = false;
  } catch (e) {
    loginClicked = false;
    toast(loginErrorMessage(e), 4000);
  }
});

function loginErrorMessage(e) {
  switch (e.code) {
    case "auth/popup-blocked":
      return "로그인 창(팝업)이 차단됐어요. 브라우저 설정에서 팝업을 허용한 뒤 다시 눌러 주세요.";
    case "auth/operation-not-supported-in-environment":
    case "auth/web-storage-unsupported":
      return "이 브라우저에서는 로그인이 안 돼요. Safari·크롬에서 열어 주세요 (개인정보 보호/시크릿 모드라면 꺼 주세요).";
    case "auth/unauthorized-domain":
      return "로그인이 허용되지 않은 주소예요. (Firebase 승인된 도메인 설정 필요)";
    case "auth/network-request-failed":
      return "인터넷 연결을 확인해 주세요.";
    default:
      return "로그인 실패: " + (e.message || e);
  }
}
$("btnGuest").addEventListener("click", () => beginSession(null));

// 이미 로그인된 사용자(재방문)는 시작 화면을 건너뜀
backend.onAuth((user) => { if (user && !state.started) beginSession(user); });

// 택1 이후: 프로필 불러오기 → 캐릭터 꾸미기 → 지도
async function beginSession(user) {
  if (state.started) return;
  state.started = true;
  state.user = user;
  $("start").classList.add("hidden");
  $("who").textContent = user ? `· ${user.name}` : "· 게스트";

  let profile = null;
  if (user) {
    profile = await backend.loadProfile(user.uid).catch(() => null);
    const saved = profile?.character ?? profile?.gender;
    if (saved != null) applyCharacter(normalizeCharacter(saved), { save: false });
    await loadUserDays(profile);
  } else {
    days = sanitizeDays(readJSON(sessionStorage, GUEST_DAYS_KEY, {}));
    sessionStorage.removeItem(GUEST_TRAIL_KEY);
  }
  rollDay(true);
  renderReviews();

  // 직접 고른 경우(게스트/로그인 버튼)나 저장된 캐릭터가 없으면 꾸미기 화면을 보여줌
  const hasSaved = user && (profile?.character != null || profile?.gender != null);
  if (!user || loginClicked || !hasSaved) {
    openCustomizer({ firstTime: true, onDone: startTracking });
  } else {
    startTracking();
  }
}

// ===================== 캐릭터 꾸미기 (헤어 5 × 피부 5 × 옷 5) =====================
let draft = null;          // 꾸미는 중인 캐릭터
let customOnDone = null;

function openCustomizer({ firstTime = false, onDone = null } = {}) {
  draft = { ...state.character };
  customOnDone = onDone;
  $("btnCustomDone").textContent = firstTime ? "이 캐릭터로 시작하기" : "저장";
  $("btnCustomCancel").classList.toggle("hidden", firstTime);
  renderCustomizer();
  $("custom").classList.remove("hidden");
}

function renderCustomizer() {
  $("customPreview").innerHTML = walkerHtml(draft, 6);
  // 헤어·옷 버튼은 "지금 캐릭터에 그 항목만 바꾼 모습"으로 미리 보여줌
  $("pickHair").innerHTML = HAIRS.map((h, i) =>
    pickButton("hair", i, previewSvg({ ...draft, hair: i }, 3), h.name)).join("");
  $("pickSkin").innerHTML = SKINS.map((sk, i) =>
    pickButton("skin", i, `<span class="swatch" style="background:${sk.S}"></span>`, sk.name)).join("");
  $("pickOutfit").innerHTML = OUTFITS.map((o, i) =>
    pickButton("outfit", i, previewSvg({ ...draft, outfit: i }, 3), o.name)).join("");
}

function pickButton(part, i, visual, name) {
  const sel = draft[part] === i ? " selected" : "";
  return `<button class="pick${sel}" data-part="${part}" data-i="${i}" title="${name}" aria-label="${name}">${visual}<span>${name}</span></button>`;
}

$("custom").addEventListener("click", (e) => {
  const btn = e.target.closest(".pick");
  if (!btn) return;
  draft[btn.dataset.part] = Number(btn.dataset.i);
  renderCustomizer();
});

$("btnRandom").addEventListener("click", () => {
  const r = (n) => Math.floor(Math.random() * n);
  draft = { hair: r(HAIRS.length), skin: r(SKINS.length), outfit: r(OUTFITS.length) };
  renderCustomizer();
});

$("btnCustomDone").addEventListener("click", () => {
  applyCharacter(draft);
  $("custom").classList.add("hidden");
  const done = customOnDone;
  customOnDone = null;
  done?.();
});
$("btnCustomCancel").addEventListener("click", () => $("custom").classList.add("hidden"));

function applyCharacter(c, { save = true } = {}) {
  state.character = normalizeCharacter(c);
  writeJSON(localStorage, CHAR_KEY, state.character);
  $("startWalker").innerHTML = walkerHtml(state.character, 4);
  if (walker) {
    walker.setIcon(makeWalkerIcon());
    walker.getElement()?.classList.toggle("left", state.facingLeft);
  }
  if (save && state.user) backend.saveProfile(state.user.uid, { character: state.character }).catch(() => {});
}

// ===================== 위치 추적 =====================
function startTracking() {
  $("status").textContent = "위치 찾는 중…";
  if (DEMO) return startDemo();
  if (!("geolocation" in navigator)) {
    $("status").textContent = "이 브라우저는 위치 기능을 지원하지 않아요.";
    return;
  }
  showLocating("📍 현재 위치를 찾는 중…");
  // 1) 빠른 대략 위치로 먼저 지도 이동 (Wi-Fi/기지국, 캐시 허용)
  navigator.geolocation.getCurrentPosition(
    (p) => {
      if (walker) return; // 정밀 위치가 먼저 왔으면 무시
      map.setView([p.coords.latitude, p.coords.longitude], 17);
      hideLocating();
    },
    () => {},
    { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 }
  );
  // 2) 정밀 GPS로 계속 추적
  navigator.geolocation.watchPosition(
    (p) => onPosition(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
    onGeoError,
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
  );
}

function onPosition(lat, lng, accuracy) {
  const pos = L.latLng(lat, lng);
  $("status").textContent = `정확도 ±${formatDistance(accuracy)}`;
  state.lastAccuracy = accuracy;
  updateAccuracyWarning(accuracy);

  if (!walker) {
    walker = L.marker(pos, { icon: makeWalkerIcon(), zIndexOffset: 1000 }).addTo(map);
    accuracyCircle = L.circle(pos, { radius: accuracy, color: "#3b82f6", weight: 1, fillOpacity: 0.08 }).addTo(map);
    map.setView(pos, 18);
    hideLocating();
  }

  // 이동 방향에 따라 좌우 반전
  if (state.current && Math.abs(lng - state.current.lng) > 1e-7) {
    state.facingLeft = lng < state.current.lng;
    walker.getElement()?.classList.toggle("left", state.facingLeft);
  }
  walker.setLatLng(pos);
  accuracyCircle.setLatLng(pos).setRadius(accuracy);

  // 지나온 길 (정확도 좋고, 일정 거리 이상 움직였을 때만)
  rollDay(); // 자정이 지났으면 새 날짜로 (지도의 선도 새로 시작)
  const last = trail[trail.length - 1];
  const moved = last ? map.distance([last[0], last[1]], pos) : Infinity;
  if (accuracy <= MAX_ACCURACY_M && moved >= MIN_STEP_M) {
    const p = [lat, lng, Math.floor(Date.now() / 1000)];
    trail.push(p);
    if (trail.length > T.MAX_POINTS_PER_DAY) {
      trail.splice(0, trail.length - T.MAX_POINTS_PER_DAY);
      trailLine.setLatLngs(T.segments(trail));
    } else {
      addToTrailLine(last, p);
    }
    saveTrail();
    if (last) state.lastMoveAt = Date.now();
  }

  state.current = pos;
  if (state.follow) map.panTo(pos, { animate: true });
  maybeUpdateRoad(pos);
  updateSubmit();
}

// 최근 3초 안에 움직였으면 걷기 애니메이션
setInterval(() => {
  walker?.getElement()?.classList.toggle("walking", Date.now() - state.lastMoveAt < 3000);
}, 500);

function onGeoError(err) {
  const msg = {
    1: "위치 권한이 꺼져 있어요.",
    2: "위치를 찾을 수 없어요.",
    3: "위치를 찾는 데 시간이 너무 걸려요.",
  }[err.code] || "위치를 가져오지 못했어요.";
  let hint;
  if (IN_APP) {
    hint = `${IN_APP.name} 안에서 열면 위치 기능이 막히는 경우가 많아요. ${openExternalGuide()}`;
  } else if (err.code === 1) {
    hint = "주소창 옆 🔒(또는 ⓘ)를 눌러 위치를 '허용'으로 바꾸고, 휴대폰 설정에서 이 브라우저의 위치 권한도 켜 주세요.";
  } else if (err.code === 2) {
    hint = "휴대폰 설정에서 위치(GPS)가 켜져 있는지 확인해 주세요.";
  } else {
    hint = "실내라면 창가나 밖에서 다시 시도해 주세요.";
  }
  $("status").textContent = "위치 없음";
  if (!walker && !state.free) showLocating(`⚠️ ${msg}`, true, hint);
  else if (!walker) { /* 자유모드 사용 중이면 조용히 */ }
  else toast(msg);
}

// ----- 인앱 브라우저(인스타그램·카카오톡 등) 감지 -----
// 앱 안의 브라우저는 위치 권한을 막거나 지원하지 않는 경우가 많음 → 외부 브라우저로 안내
function detectInApp() {
  const ua = navigator.userAgent || "";
  const apps = [
    [/Instagram/i, "인스타그램"],
    [/FBAN|FBAV|FB_IAB|FBIOS/i, "페이스북"],
    [/KAKAOTALK/i, "카카오톡"],
    [/NAVER\(inapp|NAVER\/\d/i, "네이버 앱"],
    [/DaumApps/i, "다음 앱"],
    [/\bLine\//i, "라인"],
    [/everytimeApp/i, "에브리타임"],
    [/BAND\//i, "밴드"],
    [/Twitter|TwitterAndroid/i, "X(트위터)"],
    [/ThreadsApp|Barcelona/i, "스레드"],
  ];
  for (const [re, name] of apps) if (re.test(ua)) return { name };
  return null;
}
const IN_APP = detectInApp();
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const IS_KAKAO = /KAKAOTALK/i.test(navigator.userAgent);

function canOpenExternal() { return IN_APP && (IS_ANDROID || IS_KAKAO); }

function openExternalGuide() {
  if (canOpenExternal()) return "'브라우저로 열기'를 눌러 주세요.";
  return "오른쪽 위(또는 아래) ⋯ 메뉴에서 '외부 브라우저로 열기' 또는 'Safari로 열기'를 눌러 주세요.";
}

function openExternal() {
  const url = location.origin + location.pathname + location.search; // #뒤는 빼야 intent 주소가 안 깨짐
  if (IS_KAKAO) {
    location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(url);
  } else if (IS_ANDROID) {
    // 안드로이드: 크롬(없으면 기본 브라우저)으로 열기
    const noScheme = url.replace(/^https?:\/\//, "");
    location.href = `intent://${noScheme}#Intent;scheme=https;action=android.intent.action.VIEW;end`;
  }
}

if (IN_APP) {
  $("inAppText").textContent = `📱 지금 ${IN_APP.name} 안에서 열려 있어요. 여기서는 Google 로그인이 안 되고 위치도 잘 안 잡혀요. 크롬·사파리 같은 브라우저로 열어 주세요. ${openExternalGuide()}`;
  $("inAppNote").classList.remove("hidden");
  $("btnOpenExternalStart").classList.toggle("hidden", !canOpenExternal());
  $("btnOpenExternal").classList.toggle("hidden", !canOpenExternal());
}
$("btnOpenExternalStart").addEventListener("click", openExternal);
$("btnOpenExternal").addEventListener("click", openExternal);
$("btnLocateFree").addEventListener("click", () => {
  hideLocating();
  enterFreeMode();
  toast("지도를 확대·이동해서 평가할 길을 십자 표시에 맞춰 주세요.");
});

// ----- 위치 부정확 경고 (GPS 없는 노트북·PC는 와이파이/IP로 추측해서 수백 m~수 km 틀림) -----
let accWarnDismissed = false;
function updateAccuracyWarning(accuracy) {
  // 깜빡임 방지: 기준보다 나쁘면 표시, 기준의 절반보다 좋아져야 숨김
  const el = $("accWarn");
  const showing = !el.classList.contains("hidden");
  const poor = showing ? accuracy > POOR_ACCURACY_M / 2 : accuracy > POOR_ACCURACY_M;
  $("status").classList.toggle("poor", poor);
  if (!poor) accWarnDismissed = false; // 좋아졌다가 다시 나빠지면 또 알려줌
  $("accWarnText").textContent =
    `⚠️ 이 기기는 위치가 부정확해요 (오차 약 ${formatDistance(accuracy)}). 정확한 기록은 휴대폰에서 이용해 주세요.`;
  el.classList.toggle("hidden", !poor || accWarnDismissed || state.free); // 자유모드에선 내 위치와 무관
}
$("btnAccWarnClose").addEventListener("click", () => {
  accWarnDismissed = true;
  $("accWarn").classList.add("hidden");
});

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

function showLocating(text, isError = false, hint = "") {
  $("locatingText").textContent = text;
  $("locatingHint").textContent = hint;
  $("locating").classList.toggle("error", isError);
  $("locating").classList.remove("hidden");
}
function hideLocating() { $("locating").classList.add("hidden"); }
$("btnRetryLocate").addEventListener("click", () => location.reload());

// ?demo → 서울시청 근처를 가상으로 걷기 (PC 테스트용)
function startDemo() {
  let [lat, lng] = trail[trail.length - 1] || [37.5663, 126.9779];
  let heading = Math.random() * Math.PI * 2;
  setInterval(() => {
    heading += (Math.random() - 0.5) * 0.6;
    lat += Math.cos(heading) * 0.00004;
    lng += Math.sin(heading) * 0.00005;
    onPosition(lat, lng, 8);
  }, 1000);
}

// ===================== 지나온 길 저장 / 백업 (날짜별) =====================
// 게스트: sessionStorage (탭을 닫으면 사라짐)
// 로그인: localStorage(최근 14일 캐시) + Firestore users/{uid}/days/{날짜} (최근 60일)
const LOCAL_CACHE_DAYS = 14;
const userDaysKey = () => `walkmap.days.${state.user.uid}`;
const dirtyDays = new Set();   // 서버에 다시 올려야 하는 날짜
let backupTimer = null;
let trailSyncBlocked = false;  // Firestore 규칙이 막고 있으면 true (이 기기에만 저장)

function sanitizeDays(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (T.isDayKey(k) && Array.isArray(v)) out[k] = v.filter((p) => Array.isArray(p) && p.length >= 2);
  }
  return out;
}

async function loadUserDays(profile) {
  const uid = state.user.uid;
  days = sanitizeDays(readJSON(localStorage, userDaysKey(), {}));

  // 예전 버전(날짜 없이 저장한 경로) → "이전 기록"으로 옮김
  const oldLocal = readJSON(localStorage, `walkmap.trail.${uid}`, []);
  const oldRemote = unflattenPairs(profile?.trail || []);
  const old = oldRemote.length >= oldLocal.length ? oldRemote : oldLocal;
  if (old.length && !days[T.LEGACY_DAY]) {
    days[T.LEGACY_DAY] = old.map((p) => [p[0], p[1], 0]);
    dirtyDays.add(T.LEGACY_DAY);
  }
  try { localStorage.removeItem(`walkmap.trail.${uid}`); } catch {}

  // 서버 기록과 합치기: 날짜마다 점이 더 많은 쪽을 사용
  try {
    const remote = await backend.listTrailDays(uid, T.MAX_DAYS);
    const remoteKeys = new Set();
    for (const { date, pts } of remote) {
      if (!T.isDayKey(date)) continue;
      remoteKeys.add(date);
      const r = T.unflatten(pts);
      if (!days[date] || r.length > days[date].length) days[date] = r;
      else if (days[date].length > r.length) dirtyDays.add(date);
    }
    for (const k of Object.keys(days)) if (!remoteKeys.has(k) && days[k].length) dirtyDays.add(k);
  } catch (e) {
    reportTrailSyncError(e);
  }
  pruneDays();
  persistDays();
  scheduleBackup();
}

// 오늘 날짜가 바뀌었으면(자정) 지도의 선을 새로 시작
function rollDay(force = false) {
  const k = T.dayKey();
  if (!force && k === todayKey) return;
  todayKey = k;
  trail = days[k] || (days[k] = []);
  trailLine.setLatLngs(T.segments(trail));
  pruneDays();
}
setInterval(() => { if (state.started) rollDay(); }, 60 * 1000);

function addToTrailLine(prev, p) {
  const rings = trailLine.getLatLngs();
  if (!rings.length || T.isBreak(prev, p)) {
    trailLine.setLatLngs(T.segments(trail)); // 10분 넘게 끊겼거나 순간이동 → 새 선 조각
  } else {
    trailLine.addLatLng([p[0], p[1]], rings[rings.length - 1]);
  }
}

function pruneDays() {
  const keys = T.sortDaysDesc(Object.keys(days)).filter((k) => k !== T.LEGACY_DAY);
  for (const k of keys.slice(T.MAX_DAYS)) delete days[k];
}

function persistDays() {
  const keep = {};
  const recent = T.sortDaysDesc(Object.keys(days)).filter((k) => days[k].length).slice(0, LOCAL_CACHE_DAYS);
  for (const k of recent) keep[k] = days[k];
  if (state.user) writeJSON(localStorage, userDaysKey(), keep);
  else writeJSON(sessionStorage, GUEST_DAYS_KEY, keep);
}

function saveTrail(dayK = todayKey) {
  persistDays();
  if (state.user) {
    dirtyDays.add(dayK);
    scheduleBackup();
  }
}

function scheduleBackup() {
  if (!backupTimer && dirtyDays.size && !trailSyncBlocked && state.user) {
    backupTimer = setTimeout(backupNow, 30 * 1000); // 30초마다 서버 백업
  }
}

async function backupNow() {
  clearTimeout(backupTimer);
  backupTimer = null;
  if (!state.user || !dirtyDays.size || trailSyncBlocked) return;
  const uid = state.user.uid;
  const list = [...dirtyDays];
  dirtyDays.clear();
  for (const k of list) {
    try {
      if (days[k]?.length) await backend.saveTrailDay(uid, k, T.flatten(days[k]));
      else await backend.deleteTrailDay(uid, k);
    } catch (e) {
      dirtyDays.add(k);
      reportTrailSyncError(e);
    }
  }
  scheduleBackup();
}
document.addEventListener("visibilitychange", () => { if (document.hidden) backupNow(); });

function reportTrailSyncError(e) {
  console.warn("지나온 길 서버 저장 실패", e);
  if (e?.code === "permission-denied" && !trailSyncBlocked) {
    trailSyncBlocked = true;
    toast("지나온 길을 서버에 저장할 수 없어요 (Firebase 규칙 업데이트 필요). 이 기기에만 저장할게요.", 5000);
  }
}

// 예전 형식 [lat,lng,lat,lng,…] → [[lat,lng],…]
function unflattenPairs(flat) {
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

// ===================== 현재 길 이름 (Nominatim) =====================
// Nominatim 이용 정책: 초당 1회 이하 → 모든 요청을 1.1초 간격으로 줄 세움
let nominatimQueue = Promise.resolve();
let lastNominatimAt = 0;
function fetchPlace(pos) {
  const job = nominatimQueue.then(async () => {
    const wait = lastNominatimAt + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=ko&lat=${pos.lat}&lon=${pos.lng}`;
    return parsePlace(await (await fetch(url)).json());
  });
  nominatimQueue = job.catch(() => {});
  return job;
}

// Nominatim 결과 → { road: 길 이름, area: "시 구 동", dong, houseNumber }
function parsePlace(data) {
  const a = data.address || {};
  const road = a.road || a.pedestrian || a.footway || a.path || a.neighbourhood || data.name || "이름 없는 길";
  const city = a.province || a.city || a.state || "";
  const gu = a.borough || a.city_district || a.county || (a.city && a.city !== city ? a.city : "") || "";
  const dong = a.quarter || a.suburb || a.neighbourhood || a.village || a.town || "";
  const area = [];
  for (const p of [city, gu, dong]) if (p && !area.includes(p)) area.push(p);
  return { road, area: area.join(" "), dong: dong !== road ? dong : "", houseNumber: a.house_number || "" };
}

const activePlace = () => (state.free ? state.freePlace : state.gpsPlace);
const activeRoad = () => (state.free ? state.freeRoad : state.gpsRoad);
const targetPos = () => (state.free ? state.freeTarget : state.current);

function showRoad() {
  $("roadName").textContent = state.free && state.freeLoading ? "길 찾는 중…" : activeRoad() || "-";
  renderRoadInfo();
  updateSubmit();
}

let lastRoadQuery = { at: 0, pos: null };
async function maybeUpdateRoad(pos) {
  const now = Date.now();
  const far = !lastRoadQuery.pos || map.distance(lastRoadQuery.pos, pos) > 25;
  if (!far || now - lastRoadQuery.at < 5000) return; // 이용 정책: 과도한 요청 금지
  lastRoadQuery = { at: now, pos };
  try {
    state.gpsPlace = await fetchPlace(pos);
    state.gpsRoad = state.gpsPlace.road;
  } catch {
    state.gpsRoad = state.gpsRoad || "알 수 없는 길";
  }
  if (!state.free) showRoad();
}

// ===================== 자유모드 =====================
// 지도를 움직이면 화면의 십자 표시가 가리키는 곳의 길을 평가할 수 있어요.
// (GPS가 없거나 부정확한 기기에서도 사용 가능)
$("btnFreeMode").addEventListener("click", () => (state.free ? exitFreeMode() : enterFreeMode()));

function enterFreeMode() {
  state.free = true;
  state.follow = false;
  $("btnFollow").classList.remove("active");
  document.body.classList.add("free-mode");
  $("btnFreeMode").textContent = "📍 내 위치로 돌아가기";
  $("roadLabel").textContent = "📌 선택한 길";
  $("crosshair").classList.remove("hidden");
  $("accWarn").classList.add("hidden");
  placeCrosshair();
  updateFreeTarget();
  toast("지도를 움직여서 평가할 길을 십자 표시에 맞춰 주세요.");
}

function exitFreeMode() {
  state.free = false;
  document.body.classList.remove("free-mode");
  $("btnFreeMode").textContent = "🗺️ 자유모드로 전환하기";
  $("roadLabel").textContent = "지금 있는 길";
  $("crosshair").classList.add("hidden");
  state.follow = true;
  $("btnFollow").classList.add("active");
  if (state.current) map.setView(state.current, Math.max(map.getZoom(), 17));
  if (state.lastAccuracy != null) updateAccuracyWarning(state.lastAccuracy);
  showRoad();
}

// 십자 표시는 "상단바와 평가 패널 사이, 실제로 보이는 지도 영역의 가운데"에 둠
function crosshairPoint() {
  const mapRect = $("map").getBoundingClientRect();
  const top = document.querySelector(".topbar").getBoundingClientRect().bottom;
  const bottom = Math.min($("panel").getBoundingClientRect().top, window.innerHeight);
  return L.point(mapRect.width / 2, (top + bottom) / 2 - mapRect.top);
}

function placeCrosshair() {
  const p = crosshairPoint();
  $("crosshair").style.left = `${p.x}px`;
  $("crosshair").style.top = `${p.y}px`;
}

let freeTimer = null;
let freeSeq = 0;
function updateFreeTarget() {
  if (!state.free) return;
  state.freeTarget = map.containerPointToLatLng(crosshairPoint());
  state.freeLoading = true;
  showRoad();
  clearTimeout(freeTimer);
  // 지도를 멈추고 잠깐 뒤에 길 이름 조회 (움직이는 중엔 요청 안 함)
  freeTimer = setTimeout(async () => {
    const seq = ++freeSeq;
    const pos = state.freeTarget;
    let place;
    try { place = await fetchPlace(pos); } catch { place = { road: "알 수 없는 길", area: "", dong: "", houseNumber: "" }; }
    const road = place.road;
    if (seq !== freeSeq || !state.free) return; // 그 사이 또 움직였으면 버림
    state.freeRoad = road;
    state.freePlace = place;
    state.freeLoading = false;
    showRoad();
  }, 700);
}

// 움직이기 시작하면 바로 "길 찾는 중" (멈추기 전엔 남기기 버튼 비활성)
map.on("movestart", () => { if (state.free) { state.freeLoading = true; showRoad(); } });
map.on("moveend", updateFreeTarget);
// 자유모드에서 지도를 탭하면 그 지점을 십자 표시로 가져옴
map.on("click", (e) => {
  if (!state.free) return;
  map.panBy(e.containerPoint.subtract(crosshairPoint()));
});
window.addEventListener("resize", () => { if (state.free) { placeCrosshair(); updateFreeTarget(); } });
$("panel").addEventListener("transitionend", () => { if (state.free) { placeCrosshair(); updateFreeTarget(); } });

// ===================== 평가 / 코멘트 / 사진 =====================
document.querySelectorAll(".rate").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.rating = state.rating === btn.dataset.rating ? null : btn.dataset.rating;
    document.querySelectorAll(".rate").forEach((b) => b.classList.toggle("selected", b.dataset.rating === state.rating));
    updateSubmit();
  });
});

$("comment").addEventListener("input", () => {
  $("charCount").textContent = `${$("comment").value.length}/200`;
  updateSubmit();
});

$("photoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) return toast("이미지 파일만 올릴 수 있어요.");
  try {
    state.photo = await compressImage(file);
    $("photoPreview").querySelector("img").src = state.photo;
    $("photoPreview").classList.remove("hidden");
  } catch {
    toast("사진을 읽을 수 없어요.");
  }
  updateSubmit();
});

$("btnRemovePhoto").addEventListener("click", clearPhoto);

function clearPhoto() {
  state.photo = null;
  $("photoPreview").classList.add("hidden");
  $("photoPreview").querySelector("img").removeAttribute("src");
  updateSubmit();
}

function updateSubmit() {
  // "불편해요"를 골랐을 때만 민원 버튼 표시
  $("btnComplaint").classList.toggle("hidden", state.rating !== "bad");
  const hasContent = state.rating || $("comment").value.trim() || state.photo;
  const notReady = state.free ? !state.freeTarget || state.freeLoading : !state.current;
  $("btnSubmit").disabled = notReady || !hasContent;
}

$("btnSubmit").addEventListener("click", async () => {
  const pos = targetPos();
  if (!pos) return toast("아직 위치를 찾지 못했어요.");
  const review = {
    lat: pos.lat,
    lng: pos.lng,
    road: activeRoad() || "알 수 없는 길",
    rating: state.rating,                       // "good" | "bad" | null
    comment: $("comment").value.trim().slice(0, 200),
    hasPhoto: !!state.photo,
    authorId: state.user ? state.user.uid : null, // 게스트는 작성자 정보 없음
    createdAt: Date.now(),
  };
  $("btnSubmit").disabled = true;
  $("btnSubmit").textContent = "저장 중…";
  try {
    const id = await backend.addReview(review, state.photo);
    if (!state.user) {
      state.guestMine.add(id);
      writeJSON(sessionStorage, GUEST_MINE_KEY, [...state.guestMine]);
      renderReviews();
    }
    toast(state.rating === "bad" ? "불편 신고 고마워요!" : "남겼어요!");
    refreshMyList();
    state.rating = null;
    $("comment").value = "";
    $("charCount").textContent = "0/200";
    document.querySelectorAll(".rate").forEach((b) => b.classList.remove("selected"));
    clearPhoto();
  } catch (e) {
    toast(e.name === "QuotaExceededError" ? "저장 공간이 부족해요." : "저장에 실패했어요: " + e.message);
  }
  $("btnSubmit").textContent = "남기기";
  updateSubmit();
});

// ===================== 안전신문고 민원 넣기 =====================
// "불편해요" → 위치·코멘트·사진으로 신고 문안을 만들어 복사하고 안전신문고로 이동.
// (안전신문고는 외부에서 내용을 자동으로 채울 수 없어서, 복사 → 붙여넣기 방식)
const SAFETY_REPORT_URL = "https://www.safetyreport.go.kr/";

$("btnComplaint").addEventListener("click", () => {
  if (!targetPos()) return toast("아직 위치를 찾지 못했어요.");
  $("complaintText").value = buildComplaintText();
  const hasPhoto = !!state.photo;
  $("complaintPhotoRow").classList.toggle("hidden", !hasPhoto);
  if (hasPhoto) {
    $("complaintPhoto").src = state.photo;
    $("btnSavePhoto").href = state.photo;
  }
  $("complaint").classList.remove("hidden");
});
$("btnComplaintClose").addEventListener("click", () => $("complaint").classList.add("hidden"));

// 링크(새 탭으로 안전신문고 열기)를 누르는 순간 복사 → 팝업 차단 없이 이동
$("btnGoSafety").href = SAFETY_REPORT_URL;
$("btnGoSafety").addEventListener("click", () => {
  const ta = $("complaintText");
  let ok = false;
  try { ta.select(); ok = document.execCommand("copy"); } catch {}
  navigator.clipboard?.writeText(ta.value).catch(() => {});
  ta.setSelectionRange(0, 0);
  toast(ok || navigator.clipboard ? "📋 복사했어요! 안전신문고 신고 내용에 붙여넣으세요." : "복사가 안 됐어요. 문안을 길게 눌러 직접 복사해 주세요.");
});

function buildComplaintText() {
  const pos = targetPos();
  const place = activePlace() || {};
  const roadRaw = activeRoad();
  const road = roadRaw && !/알 수 없는|이름 없는/.test(roadRaw) ? roadRaw : "";
  const spot = [place.dong, road].filter(Boolean).join(" ") || "해당 위치";
  const address = [place.area, road, place.houseNumber].filter(Boolean).join(" ");

  let comment = politeEnding($("comment").value.trim().replace(/\s+/g, " "));
  if (comment && !/[.!?。]$/.test(comment)) comment += ".";
  const summary = comment
    ? `${spot} 앞 ${comment} 보행에 불편이 있어 현장 확인 및 조치를 요청드립니다.`
    : `${spot} 앞 보행로가 걷기에 불편합니다. 현장 확인 및 조치를 요청드립니다.`;

  const lat = pos.lat.toFixed(6), lng = pos.lng.toFixed(6);
  return [
    summary,
    "",
    `■ 위치: ${address || "(주소를 직접 입력해 주세요)"}`,
    `■ 좌표: ${lat}, ${lng}`,
    `■ 지도: https://map.kakao.com/link/map/신고위치,${lat},${lng}`,
    state.photo ? "■ 사진: 현장 사진 첨부" : null,
  ].filter((l) => l !== null).join("\n");
}

// 구어체 끝맺음을 민원용 존댓말로 (문장마다)
// 예: "깨져 있어요" → "깨져 있습니다", "힘들어요" → "힘듭니다", "미끄러워요" → "미끄럽습니다"
function politeEnding(text) {
  return text.replace(/([가-힣]+)요(?=[.!?]|\s*$)/g, (m, word) => politeWord(word) ?? m);
}

function politeWord(w) {
  // 고정 표현
  for (const [a, b] of [["해", "합니다"], ["돼", "됩니다"], ["이에", "입니다"], ["예", "입니다"]]) {
    if (w.endsWith(a)) return w.slice(0, -a.length) + b;
  }
  const HANGUL = 0xac00;
  const jong = (ch) => (ch.charCodeAt(0) - HANGUL) % 28;           // 받침 번호 (0 = 없음, 8 = ㄹ, 17 = ㅂ)
  const withJong = (ch, j) => String.fromCharCode(ch.charCodeAt(0) - jong(ch) + j);
  // ㅂ 불규칙: 어려워 → 어렵, 미끄러워 → 미끄럽
  if (w.length >= 2 && w.endsWith("워")) {
    const stem = w.slice(0, -1);
    return stem.slice(0, -1) + withJong(stem.slice(-1), 17) + "습니다";
  }
  // 받침 있는 말 + 아/어: 좁아 → 좁습니다, 있어 → 있습니다, 힘들어 → 힘듭니다(ㄹ 탈락)
  if (w.length >= 2 && /[아어]$/.test(w)) {
    const stem = w.slice(0, -1);
    const last = stem.slice(-1);
    const j = jong(last);
    if (j === 8) return stem.slice(0, -1) + withJong(last, 17) + "니다";
    if (j > 0) return stem + "습니다";
  }
  return null; // 모르는 형태는 그대로 둠
}

// 사진 압축: 긴 변 800px, JPEG. 600KB 넘으면 화질을 낮춤.
async function compressImage(file, maxSide = 800) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let q = 0.75;
    let data = canvas.toDataURL("image/jpeg", q);
    while (data.length > 600_000 && q > 0.3) { q -= 0.1; data = canvas.toDataURL("image/jpeg", q); }
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ===================== 리뷰 표시 =====================
function isMine(r) {
  return state.user ? r.authorId === state.user.uid : state.guestMine.has(r.id);
}

const markersById = new Map();
function renderReviews() {
  reviewLayer.clearLayers();
  markersById.clear();
  for (const r of state.reviews) {
    const color = r.rating === "good" ? "#16a34a" : r.rating === "bad" ? "#dc2626" : "#6b7280";
    const marker = L.circleMarker([r.lat, r.lng], {
      radius: isMine(r) ? 9 : 7,
      color: isMine(r) ? "#f97316" : "#111",
      weight: isMine(r) ? 3 : 2,
      fillColor: color,
      fillOpacity: 1,
    })
      .bindPopup(() => reviewHtml(r))
      .on("popupopen", (e) => hydratePhotos(e.popup.getElement()))
      .addTo(reviewLayer);
    markersById.set(r.id, marker);
  }
  renderRoadInfo();
}

function renderRoadInfo() {
  const onRoad = state.reviews.filter((r) => r.road === activeRoad()).sort((a, b) => b.createdAt - a.createdAt);
  const good = onRoad.filter((r) => r.rating === "good").length;
  const bad = onRoad.filter((r) => r.rating === "bad").length;
  $("roadSummary").textContent = good || bad ? `😊 ${good} · 😣 ${bad}` : "아직 평가가 없어요";
  $("recentCount").textContent = onRoad.length;
  $("recentList").innerHTML = onRoad.slice(0, 30).map((r) => `<li>${reviewHtml(r)}</li>`).join("") ||
    `<li class="muted">첫 코멘트를 남겨보세요!</li>`;
  if ($("recent").open) hydratePhotos($("recentList"));
}
$("recent").addEventListener("toggle", () => { if ($("recent").open) hydratePhotos($("recentList")); });

function reviewHtml(r) {
  const label = r.rating === "good" ? `<b class="pop-good">😊 편해요</b>`
    : r.rating === "bad" ? `<b class="pop-bad">😣 불편해요</b>` : "💬";
  const mine = isMine(r) ? `<span class="mine">내 글</span>` : "";
  const del = state.user && r.authorId === state.user.uid
    ? `<button class="del" data-del="${escapeHtml(r.id)}">삭제</button>` : "";
  const photo = r.hasPhoto ? `<div class="photo-slot" data-id="${escapeHtml(r.id)}"><span class="muted">📷 사진 불러오는 중…</span></div>` : "";
  return `${label}${mine} ${escapeHtml(r.comment || "")}${photo}
    <div class="meta">${escapeHtml(r.road || "")} · ${new Date(r.createdAt).toLocaleString("ko-KR")}${del}</div>`;
}

// 사진은 필요할 때만 불러옴 (팝업 열기 / 목록 펼치기)
const photoCache = new Map();
function hydratePhotos(root) {
  root?.querySelectorAll(".photo-slot:not(.loaded)").forEach(async (slot) => {
    slot.classList.add("loaded");
    const id = slot.dataset.id;
    try {
      if (!photoCache.has(id)) photoCache.set(id, await backend.getPhoto(id));
      const src = photoCache.get(id);
      if (src && src.startsWith("data:image/")) {
        const img = new Image();
        img.alt = "첨부 사진";
        img.src = src;
        slot.replaceChildren(img);
      } else {
        slot.innerHTML = `<span class="muted">사진을 찾을 수 없어요</span>`;
      }
    } catch {
      slot.innerHTML = `<span class="muted">사진을 불러오지 못했어요</span>`;
    }
  });
}

// ===================== 내가 평가한 코멘트 (오른쪽 📝 버튼) =====================
// 로그인 사용자: 계정(authorId)으로 모아서 보여줌 → 어느 기기에서든 확인 가능
// 게스트: 작성자 정보를 저장하지 않으므로 목록에 모이지 않음 (지도에는 그대로 남음)
$("btnMyList").addEventListener("click", () => {
  $("menu").classList.add("hidden");
  $("myList").classList.remove("hidden");
  refreshMyList();
});
$("btnMyListClose").addEventListener("click", () => $("myList").classList.add("hidden"));

async function refreshMyList() {
  if ($("myList").classList.contains("hidden")) return;
  const body = $("myListBody");
  if (!state.user) {
    $("myCount").textContent = "";
    body.innerHTML = `<div class="empty">
      <p>👤 게스트로 남긴 평가는 이 목록에 저장되지 않아요.</p>
      <p class="muted">게스트 평가도 지도에는 그대로 남아 다른 사람들이 볼 수 있어요.</p>
      <p class="muted">로그인하면 내가 남긴 평가를 여기서 모아 보고, 다른 기기에서도 확인·삭제할 수 있어요.</p>
      ${backend.canLogin ? `<button id="btnGoLogin" class="big primary">🔐 로그인하러 가기</button>` : ""}
    </div>`;
    $("btnGoLogin")?.addEventListener("click", () => {
      if (!confirm("처음 화면으로 돌아가요. 게스트로 걸은 경로 기록은 사라져요. 계속할까요?")) return;
      sessionStorage.removeItem(GUEST_TRAIL_KEY);
      sessionStorage.removeItem(GUEST_DAYS_KEY);
      sessionStorage.removeItem(GUEST_MINE_KEY);
      location.reload();
    });
    return;
  }
  body.innerHTML = `<p class="muted pad">불러오는 중…</p>`;
  let list;
  try {
    list = await backend.listMyReviews(state.user.uid);
  } catch (e) {
    body.innerHTML = `<p class="muted pad">불러오지 못했어요: ${escapeHtml(e.message)}</p>`;
    return;
  }
  $("myCount").textContent = `(${list.length})`;
  body.innerHTML = list.length
    ? `<ul class="my-items">${list.map((r) => `<li>${reviewHtml(r)}
        <button class="goto" data-goto="${escapeHtml(r.id)}" data-lat="${Number(r.lat)}" data-lng="${Number(r.lng)}">🗺️ 지도에서 보기</button></li>`).join("")}</ul>`
    : `<div class="empty"><p>아직 남긴 평가가 없어요.</p><p class="muted">길을 걸으며 편해요/불편해요를 남겨 보세요!</p></div>`;
  hydratePhotos(body);
}

// 목록에서 "지도에서 보기" → 그 위치로 이동하고 팝업 열기
$("myListBody").addEventListener("click", (e) => {
  const btn = e.target.closest(".goto");
  if (!btn) return;
  const ll = L.latLng(Number(btn.dataset.lat), Number(btn.dataset.lng));
  if (!Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) return;
  if (window.innerWidth < 700) $("myList").classList.add("hidden"); // 휴대폰에선 지도가 보이게 닫음
  state.follow = false;
  $("btnFollow").classList.remove("active");
  map.setView(ll, 18);
  const marker = markersById.get(btn.dataset.goto);
  if (marker) setTimeout(() => marker.openPopup(), 300);
});

// 내 글 삭제 (로그인 사용자만)
document.addEventListener("click", async (e) => {
  const id = e.target.closest?.("[data-del]")?.dataset.del;
  if (!id || !confirm("이 글을 삭제할까요?")) return;
  try { await backend.deleteReview(id); map.closePopup(); toast("삭제했어요."); refreshMyList(); }
  catch (err) { toast("삭제 실패: " + err.message); }
});

// ===================== 메뉴 / 기타 UI =====================
$("btnMenu").addEventListener("click", () => {
  $("accountInfo").innerHTML = state.user
    ? `🔐 <b>${escapeHtml(state.user.name)}</b> 로 로그인 중<br><span class="muted">지나온 길과 내 글이 백업되고 있어요.</span>`
    : `👤 <b>게스트</b><br><span class="muted">사이트를 나가면 내가 쓴 글과 지나온 길 기록이 사라져요.</span>`;
  $("btnExit").textContent = state.user ? "로그아웃" : "처음 화면으로 (게스트 기록 지우기)";
  $("menu").classList.remove("hidden");
});
$("btnCustomize").addEventListener("click", () => {
  $("menu").classList.add("hidden");
  openCustomizer();
});
$("btnCloseMenu").addEventListener("click", () => $("menu").classList.add("hidden"));
$("btnExit").addEventListener("click", async () => {
  if (state.user) {
    // 로그아웃 전에 남은 경로를 서버에 올림 (최대 5초 기다림)
    await Promise.race([backupNow(), new Promise((r) => setTimeout(r, 5000))]);
    await backend.signOut();
  } else {
    sessionStorage.removeItem(GUEST_TRAIL_KEY);
    sessionStorage.removeItem(GUEST_DAYS_KEY);
    sessionStorage.removeItem(GUEST_MINE_KEY);
  }
  location.reload();
});

$("btnFollow").addEventListener("click", () => {
  if (state.free) return exitFreeMode(); // 자유모드 중 ◎ = 내 위치로 돌아가기
  state.follow = !state.follow;
  $("btnFollow").classList.toggle("active", state.follow);
  if (state.follow && state.current) map.setView(state.current, Math.max(map.getZoom(), 17));
});
map.on("dragstart", () => { state.follow = false; $("btnFollow").classList.remove("active"); });

$("btnClear").addEventListener("click", () => {
  if (!confirm("오늘 지나온 길을 지울까요? (지난 날짜 기록은 그대로예요)")) return;
  clearDay(todayKey);
});

function clearDay(k) {
  if (k === todayKey) {
    trail.length = 0;
    trailLine.setLatLngs([]);
  } else {
    delete days[k];
  }
  if (viewingDay === k) closeHistory();
  saveTrail(k);
}

// ===================== 👣 내가 지나온 길 (날짜별) =====================
const historyLayer = L.layerGroup().addTo(map);
let viewingDay = null;

$("btnTrails").addEventListener("click", () => {
  $("menu").classList.add("hidden");
  $("myList").classList.add("hidden");
  $("trailDrawer").classList.remove("hidden");
  renderTrailList();
});
$("btnTrailClose").addEventListener("click", () => $("trailDrawer").classList.add("hidden"));
$("btnMyList").addEventListener("click", () => $("trailDrawer").classList.add("hidden"));

function renderTrailList() {
  const keys = T.sortDaysDesc(Object.keys(days).filter((k) => days[k]?.length));
  const notes = [];
  if (!state.user) {
    notes.push(`<div class="note">👤 게스트 기록은 이 창(탭)을 닫으면 사라져요. 로그인하면 최근 60일 기록이 날짜별로 저장돼요.</div>`);
  } else if (trailSyncBlocked) {
    notes.push(`<div class="note warn">⚠️ 서버 저장이 막혀 있어 이 기기에만 저장 중이에요 (Firebase 규칙 업데이트 필요).</div>`);
  }
  notes.push(`<div class="note muted">ℹ️ 웹앱은 화면을 켜 두고 이 페이지가 열려 있을 때만 기록돼요.</div>`);
  const items = keys.map((k) => {
    const st = T.dayStats(days[k]);
    const range = st.start ? `${T.formatClock(st.start)} ~ ${T.formatClock(st.end)}` : "시간 정보 없음";
    return `<li class="day-item${k === viewingDay ? " active" : ""}">
      <button class="day-btn" data-day="${k}">
        <b>${T.formatDay(k)}</b>${k === todayKey ? ` <span class="today">오늘</span>` : ""}
        <span class="muted">${T.formatKm(st.distance)} · ${range}</span>
      </button>
      <button class="del-day" data-day="${k}" title="이 날 기록 삭제">🗑</button>
    </li>`;
  }).join("");
  $("trailBody").innerHTML = notes.join("") + (items
    ? `<ul class="day-list">${items}</ul>`
    : `<div class="empty"><p>아직 기록이 없어요.</p><p class="muted">걸으면 자동으로 날짜별로 기록돼요.</p></div>`);
}

$("trailBody").addEventListener("click", (e) => {
  const del = e.target.closest(".del-day");
  if (del) {
    const k = del.dataset.day;
    if (!T.isDayKey(k) || !confirm(`${T.formatDay(k)} 기록을 삭제할까요?`)) return;
    clearDay(k);
    renderTrailList();
    return;
  }
  const btn = e.target.closest(".day-btn");
  if (btn && T.isDayKey(btn.dataset.day)) showDay(btn.dataset.day);
});

function showDay(k) {
  const pts = days[k];
  if (!pts?.length) return;
  historyLayer.clearLayers();
  viewingDay = k;
  if (k !== todayKey) {
    L.polyline(T.segments(pts), { color: "#7c3aed", weight: 6, opacity: 0.9, dashArray: "10 8", lineCap: "butt" })
      .addTo(historyLayer);
  }
  const first = pts[0], last = pts[pts.length - 1];
  const tip = (label, p) => (p[2] ? `${label} ${T.formatClock(p[2])}` : label);
  L.circleMarker([first[0], first[1]], { radius: 8, color: "#111", weight: 2, fillColor: "#22c55e", fillOpacity: 1 })
    .bindTooltip(tip("출발", first)).addTo(historyLayer);
  L.circleMarker([last[0], last[1]], { radius: 8, color: "#111", weight: 2, fillColor: "#ef4444", fillOpacity: 1 })
    .bindTooltip(tip("도착", last)).addTo(historyLayer);

  if (state.free) exitFreeMode();
  state.follow = false;
  $("btnFollow").classList.remove("active");
  if (window.innerWidth < 700) $("trailDrawer").classList.add("hidden"); // 휴대폰: 지도가 보이게
  const panelTop = $("panel").getBoundingClientRect().top;
  map.fitBounds(L.latLngBounds(pts.map((p) => [p[0], p[1]])), {
    paddingTopLeft: [24, 80],
    paddingBottomRight: [72, Math.max(24, window.innerHeight - panelTop + 24)],
    maxZoom: 18,
  });
  const st = T.dayStats(pts);
  $("historyText").textContent = `👣 ${T.formatDay(k)}${k === todayKey ? " (오늘)" : ""} · ${T.formatKm(st.distance)}`;
  $("historyBar").classList.remove("hidden");
  renderTrailList();
}

function closeHistory() {
  historyLayer.clearLayers();
  viewingDay = null;
  $("historyBar").classList.add("hidden");
}
$("btnHistoryClose").addEventListener("click", () => {
  closeHistory();
  state.follow = true;
  $("btnFollow").classList.add("active");
  if (state.current) map.setView(state.current, Math.max(map.getZoom(), 17));
  if (!$("trailDrawer").classList.contains("hidden")) renderTrailList();
});

$("panelHandle").addEventListener("click", () => $("panel").classList.toggle("collapsed"));

// 리뷰 구독은 모든 함수/상수가 준비된 뒤 시작
backend.subscribeReviews((list) => {
  state.reviews = list;
  renderReviews();
});

// ===================== 유틸 =====================
function readLocal(k) { try { return localStorage.getItem(k); } catch { return null; } }
function writeLocal(k, v) { try { localStorage.setItem(k, v); } catch {} }
function readJSON(store, k, d) { try { return JSON.parse(store.getItem(k)) ?? d; } catch { return d; } }
function writeJSON(store, k, v) { try { store.setItem(k, JSON.stringify(v)); } catch {} }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer;
function toast(msg, ms = 2200) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

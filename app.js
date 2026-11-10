import { TRAIL_COLOR, MAX_ACCURACY_M, MIN_STEP_M, POOR_ACCURACY_M } from "./config.js";
import { createBackend } from "./backend.js";
import { walkerHtml, previewSvg, HAIRS, SKINS, OUTFITS, normalizeCharacter } from "./sprite.js";

const $ = (id) => document.getElementById(id);
const DEMO = new URLSearchParams(location.search).has("demo");
const CHAR_KEY = "walkmap.character";
const OLD_GENDER_KEY = "walkmap.gender"; // 예전 버전(여/남) 설정
const GUEST_TRAIL_KEY = "walkmap.trail.guest";
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
  roadName: "",
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

let trail = [];
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
  loginClicked = true;
  try { await backend.signIn(); } // 성공하면 onAuth 에서 이어짐
  catch (e) { loginClicked = false; toast("로그인 실패: " + (e.message || e)); }
});
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
    const local = readJSON(localStorage, userTrailKey(), []);
    const remote = unflatten(profile?.trail || []);
    trail = remote.length >= local.length ? remote : local;
  } else {
    trail = readJSON(sessionStorage, GUEST_TRAIL_KEY, []);
  }
  trailLine.setLatLngs(trail);
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
  const last = trail[trail.length - 1];
  const moved = last ? map.distance(last, pos) : Infinity;
  if (accuracy <= MAX_ACCURACY_M && moved >= MIN_STEP_M) {
    trail.push([lat, lng]);
    trailLine.addLatLng(pos);
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
    1: "위치 권한이 거부되었어요. 브라우저 설정에서 허용해 주세요.",
    2: "위치를 찾을 수 없어요.",
    3: "위치 요청 시간이 초과됐어요.",
  }[err.code] || err.message;
  $("status").textContent = "위치 없음";
  if (!walker) showLocating(`⚠️ ${msg}`, true);
  else toast(msg);
}

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
  el.classList.toggle("hidden", !poor || accWarnDismissed);
}
$("btnAccWarnClose").addEventListener("click", () => {
  accWarnDismissed = true;
  $("accWarn").classList.add("hidden");
});

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

function showLocating(text, isError = false) {
  $("locatingText").textContent = text;
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

// ===================== 경로 저장 / 백업 =====================
const userTrailKey = () => `walkmap.trail.${state.user.uid}`;
let backupTimer = null;
let backupDirty = false;

function saveTrail() {
  const data = trail.slice(-5000);
  if (state.user) {
    writeJSON(localStorage, userTrailKey(), data);
    backupDirty = true;
    if (!backupTimer) backupTimer = setTimeout(backupNow, 30000); // 30초마다 서버 백업
  } else {
    writeJSON(sessionStorage, GUEST_TRAIL_KEY, data);
  }
}

function backupNow() {
  clearTimeout(backupTimer);
  backupTimer = null;
  if (!state.user || !backupDirty) return;
  backupDirty = false;
  backend.saveProfile(state.user.uid, {
    trail: trail.slice(-5000).flat(),   // Firestore는 2차원 배열 불가 → [lat,lng,lat,lng,…]
    character: state.character,
    updatedAt: Date.now(),
  }).catch(() => { backupDirty = true; });
}
document.addEventListener("visibilitychange", () => { if (document.hidden) backupNow(); });

function unflatten(flat) {
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

// ===================== 현재 길 이름 (Nominatim) =====================
let lastRoadQuery = { at: 0, pos: null };
async function maybeUpdateRoad(pos) {
  const now = Date.now();
  const far = !lastRoadQuery.pos || map.distance(lastRoadQuery.pos, pos) > 25;
  if (!far || now - lastRoadQuery.at < 5000) return; // 이용 정책: 과도한 요청 금지
  lastRoadQuery = { at: now, pos };
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=ko&lat=${pos.lat}&lon=${pos.lng}`;
    const data = await (await fetch(url)).json();
    const a = data.address || {};
    state.roadName = a.road || a.pedestrian || a.footway || a.path || a.neighbourhood || data.name || "이름 없는 길";
  } catch {
    state.roadName = state.roadName || "알 수 없는 길";
  }
  $("roadName").textContent = state.roadName;
  renderRoadInfo();
}

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
  const hasContent = state.rating || $("comment").value.trim() || state.photo;
  $("btnSubmit").disabled = !state.current || !hasContent;
}

$("btnSubmit").addEventListener("click", async () => {
  if (!state.current) return toast("아직 위치를 찾지 못했어요.");
  const review = {
    lat: state.current.lat,
    lng: state.current.lng,
    road: state.roadName || "알 수 없는 길",
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

function renderReviews() {
  reviewLayer.clearLayers();
  for (const r of state.reviews) {
    const color = r.rating === "good" ? "#16a34a" : r.rating === "bad" ? "#dc2626" : "#6b7280";
    L.circleMarker([r.lat, r.lng], {
      radius: isMine(r) ? 9 : 7,
      color: isMine(r) ? "#f97316" : "#111",
      weight: isMine(r) ? 3 : 2,
      fillColor: color,
      fillOpacity: 1,
    })
      .bindPopup(() => reviewHtml(r))
      .on("popupopen", (e) => hydratePhotos(e.popup.getElement()))
      .addTo(reviewLayer);
  }
  renderRoadInfo();
}

function renderRoadInfo() {
  const onRoad = state.reviews.filter((r) => r.road === state.roadName).sort((a, b) => b.createdAt - a.createdAt);
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

// 내 글 삭제 (로그인 사용자만)
document.addEventListener("click", async (e) => {
  const id = e.target.closest?.("[data-del]")?.dataset.del;
  if (!id || !confirm("이 글을 삭제할까요?")) return;
  try { await backend.deleteReview(id); map.closePopup(); toast("삭제했어요."); }
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
    backupNow();
    await backend.signOut();
  } else {
    sessionStorage.removeItem(GUEST_TRAIL_KEY);
    sessionStorage.removeItem(GUEST_MINE_KEY);
  }
  location.reload();
});

$("btnFollow").addEventListener("click", () => {
  state.follow = !state.follow;
  $("btnFollow").classList.toggle("active", state.follow);
  if (state.follow && state.current) map.setView(state.current, Math.max(map.getZoom(), 17));
});
map.on("dragstart", () => { state.follow = false; $("btnFollow").classList.remove("active"); });

$("btnClear").addEventListener("click", () => {
  if (!confirm("지나온 길을 지울까요?")) return;
  trail = state.current ? [[state.current.lat, state.current.lng]] : [];
  trailLine.setLatLngs(trail);
  saveTrail();
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
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

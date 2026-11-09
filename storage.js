// 평가 저장소
// config.js에 Firebase 값이 있으면 Firestore(모두가 공유)에,
// 없으면 이 브라우저의 localStorage(나만 보임)에 저장합니다.

window.Store = (function () {
  const LOCAL_KEY = "walkmap.ratings";
  const FB_VERSION = "10.12.2";
  let items = [];
  let listeners = [];
  let db = null;

  function readLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function writeLocal() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
    } catch (e) { /* 저장 공간이 없을 때는 무시 */ }
  }

  function emit() {
    listeners.forEach(function (fn) { fn(items); });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function hasFirebase() {
    const fb = window.CONFIG && window.CONFIG.firebase;
    return !!(fb && fb.apiKey && fb.projectId);
  }

  async function init() {
    if (!hasFirebase()) {
      items = readLocal();
      emit();
      return "local";
    }
    try {
      const base = "https://www.gstatic.com/firebasejs/" + FB_VERSION + "/";
      await loadScript(base + "firebase-app-compat.js");
      await loadScript(base + "firebase-firestore-compat.js");
      firebase.initializeApp(window.CONFIG.firebase);
      db = firebase.firestore();
      db.collection("ratings").orderBy("ts", "desc").limit(1000)
        .onSnapshot(function (snap) {
          items = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
          emit();
        });
      return "firebase";
    } catch (e) {
      console.warn("Firebase 연결 실패, 기기 저장으로 전환합니다.", e);
      db = null;
      items = readLocal();
      emit();
      return "local";
    }
  }

  async function add(item) {
    const clean = {
      lat: Number(item.lat.toFixed(6)),
      lng: Number(item.lng.toFixed(6)),
      road: String(item.road || "").slice(0, 100),
      rating: item.rating === "good" ? "good" : "bad",
      comment: String(item.comment || "").slice(0, 200),
      ts: Date.now()
    };
    if (db) {
      await db.collection("ratings").add(clean);
    } else {
      clean.id = String(clean.ts);
      items.unshift(clean);
      writeLocal();
      emit();
    }
  }

  function onChange(fn) {
    listeners.push(fn);
    fn(items);
  }

  return { init: init, add: add, onChange: onChange, all: function () { return items; } };
})();

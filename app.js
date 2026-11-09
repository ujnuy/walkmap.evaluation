(function () {
  const CFG = window.CONFIG;
  const DEMO = new URLSearchParams(location.search).has("demo");
  const TRACK_KEY = "walkmap.track";

  const $ = function (id) { return document.getElementById(id); };

  // ---------- 지도 ----------
  const map = L.map("map", { zoomControl: false, attributionControl: true })
    .setView(DEMO ? CFG.demoCenter : CFG.startCenter, CFG.startZoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  const ratingLayer = L.layerGroup().addTo(map);

  // ---------- 지나온 길 ----------
  let track = loadTrack();
  const trackLine = L.polyline(track, { color: "#ff8c1a", weight: 6, opacity: .9 }).addTo(map);

  function loadTrack() {
    try { return JSON.parse(localStorage.getItem(TRACK_KEY)) || []; } catch (e) { return []; }
  }
  function saveTrack() {
    try { localStorage.setItem(TRACK_KEY, JSON.stringify(track.slice(-5000))); } catch (e) {}
  }

  // ---------- 캐릭터 ----------
  const heroIcon = L.divIcon({
    className: "hero-icon",
    html: '<div class="hero" id="hero"><img alt="" src="' + SPRITE.images.idle + '"></div>',
    iconSize: [36, 48],
    iconAnchor: [18, 46]
  });
  let heroMarker = null;
  let walkingUntil = 0;
  let frame = 0;

  setInterval(function () {
    const el = $("hero");
    if (!el) return;
    const img = el.querySelector("img");
    const walking = Date.now() < walkingUntil;
    el.classList.toggle("walking", walking);
    if (walking) {
      frame = (frame + 1) % 2;
      img.src = frame ? SPRITE.images.walk1 : SPRITE.images.walk2;
    } else {
      img.src = SPRITE.images.idle;
    }
  }, 180);

  // ---------- 위치 처리 ----------
  let last = null;
  let follow = true;
  let current = null;

  function onPosition(lat, lng, accuracy) {
    const here = L.latLng(lat, lng);
    current = here;

    if (!heroMarker) {
      heroMarker = L.marker(here, { icon: heroIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
      map.setView(here, CFG.startZoom);
    } else {
      heroMarker.setLatLng(here);
    }

    if (last) {
      const moved = last.distanceTo(here);
      if (moved > 1) {
        walkingUntil = Date.now() + 2500;
        const el = $("hero");
        if (el && Math.abs(here.lng - last.lng) > 1e-7) {
          el.classList.toggle("left", here.lng < last.lng);
        }
      }
    }

    // 정확도가 낮은 위치는 경로에 넣지 않음
    if (accuracy == null || accuracy <= 50) {
      const prev = track[track.length - 1];
      if (!prev || L.latLng(prev).distanceTo(here) > 3) {
        track.push([lat, lng]);
        trackLine.setLatLngs(track);
        saveTrack();
      }
    }

    last = here;
    if (follow) map.panTo(here, { animate: true });
    maybeGeocode(here);
  }

  function startGps() {
    if (!("geolocation" in navigator)) {
      toast("이 브라우저는 위치 기능을 지원하지 않아요.");
      return;
    }
    navigator.geolocation.watchPosition(
      function (p) { onPosition(p.coords.latitude, p.coords.longitude, p.coords.accuracy); },
      function (err) {
        if (err.code === 1) toast("위치 권한을 허용해 주세요. (브라우저 설정 → 위치)");
        else toast("위치를 찾지 못했어요. 잠시 후 다시 시도해요.");
        $("roadName").textContent = "위치 없음";
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
  }

  function startDemo() {
    toast("데모 모드: 가상으로 걷는 중이에요");
    const c = CFG.demoCenter;
    const route = [
      [0, 0], [0.0004, 0], [0.0008, 0.0002], [0.0008, 0.0008],
      [0.0004, 0.0011], [0, 0.0011], [-0.0003, 0.0006], [0, 0]
    ].map(function (d) { return [c[0] + d[0], c[1] + d[1]]; });
    let seg = 0, t = 0;
    setInterval(function () {
      const a = route[seg], b = route[(seg + 1) % route.length];
      t += 0.12;
      if (t >= 1) { t = 0; seg = (seg + 1) % route.length; }
      onPosition(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 5);
    }, 1000);
  }

  // ---------- 길 이름 찾기 ----------
  let currentRoad = "";
  let lastGeoAt = 0;
  let lastGeoPos = null;
  let geoBusy = false;

  async function maybeGeocode(pos) {
    const now = Date.now();
    const farEnough = !lastGeoPos || lastGeoPos.distanceTo(pos) > CFG.geocodeEveryMeters;
    const longEnough = now - lastGeoAt > CFG.geocodeEverySeconds * 1000;
    if (geoBusy) return;
    if (now - lastGeoAt < 3000) return; // 너무 자주 묻지 않기
    if (currentRoad && !farEnough && !longEnough) return;
    geoBusy = true;
    lastGeoAt = now;
    lastGeoPos = pos;
    try {
      const url = "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=ko"
        + "&lat=" + pos.lat + "&lon=" + pos.lng;
      const res = await fetch(url);
      const data = await res.json();
      const a = data.address || {};
      const name = a.road || a.pedestrian || a.footway || a.path || a.cycleway
        || a.neighbourhood || a.quarter || a.suburb || "";
      setRoad(name || "이름 없는 길");
    } catch (e) {
      if (!currentRoad) setRoad("길 이름을 못 찾았어요");
    } finally {
      geoBusy = false;
    }
  }

  function setRoad(name) {
    currentRoad = name;
    $("roadName").textContent = name;
    updateRoadStats();
  }

  function ratingsForRoad(name) {
    return Store.all().filter(function (r) { return r.road === name; });
  }

  function updateRoadStats() {
    if (!currentRoad) { $("roadStats").textContent = ""; return; }
    const list = ratingsForRoad(currentRoad);
    const good = list.filter(function (r) { return r.rating === "good"; }).length;
    const bad = list.length - good;
    $("roadStats").textContent = list.length
      ? "😊 " + good + "  😣 " + bad + "  · 눌러서 코멘트 보기"
      : "아직 평가가 없어요";
  }

  // ---------- 평가 표시 ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function renderRatings(items) {
    ratingLayer.clearLayers();
    items.forEach(function (r) {
      const good = r.rating === "good";
      L.circleMarker([r.lat, r.lng], {
        radius: 8, weight: 3, color: "#1d2b53",
        fillColor: good ? "#00b543" : "#ff004d", fillOpacity: 1
      }).bindPopup(
        "<b>" + (good ? "😊 편해요" : "😣 불편해요") + "</b><br>"
        + esc(r.road || "") + (r.comment ? "<br>" + esc(r.comment) : "")
        + "<br><small>" + fmtDate(r.ts) + "</small>"
      ).addTo(ratingLayer);
    });
    updateRoadStats();
  }

  // ---------- 평가 작성 ----------
  let pendingRating = null;

  function openRate(kind) {
    if (!current) { toast("아직 내 위치를 찾는 중이에요."); return; }
    pendingRating = kind;
    $("rateTitle").textContent = kind === "good" ? "😊 편해요" : "😣 불편해요";
    $("rateRoad").textContent = currentRoad || "현재 위치";
    $("rateComment").value = "";
    $("rateCount").textContent = "0";
    $("rateSheet").classList.remove("hidden");
  }

  $("goodBtn").onclick = function () { openRate("good"); };
  $("badBtn").onclick = function () { openRate("bad"); };
  $("rateCancel").onclick = function () { $("rateSheet").classList.add("hidden"); };
  $("rateComment").oninput = function () { $("rateCount").textContent = this.value.length; };
  $("rateSave").onclick = async function () {
    const btn = this;
    btn.disabled = true;
    try {
      await Store.add({
        lat: current.lat, lng: current.lng,
        road: currentRoad || "이름 없는 길",
        rating: pendingRating,
        comment: $("rateComment").value.trim()
      });
      $("rateSheet").classList.add("hidden");
      toast("평가를 남겼어요!");
    } catch (e) {
      toast("저장하지 못했어요. 다시 시도해 주세요.");
    } finally {
      btn.disabled = false;
    }
  };

  // ---------- 길 평가 목록 ----------
  $("roadBox").onclick = function () {
    if (!currentRoad) return;
    const list = ratingsForRoad(currentRoad);
    const good = list.filter(function (r) { return r.rating === "good"; }).length;
    $("listTitle").textContent = currentRoad;
    $("listSummary").textContent = "😊 편해요 " + good + " · 😣 불편해요 " + (list.length - good);
    const withText = list.filter(function (r) { return r.comment; });
    $("commentList").innerHTML = withText.length
      ? withText.map(function (r) {
          return "<li>" + (r.rating === "good" ? "😊 " : "😣 ") + esc(r.comment)
            + '<span class="when">' + fmtDate(r.ts) + "</span></li>";
        }).join("")
      : "<li>아직 코멘트가 없어요.</li>";
    $("listSheet").classList.remove("hidden");
  };
  $("listClose").onclick = function () { $("listSheet").classList.add("hidden"); };

  // 창 바깥을 누르면 닫기
  ["rateSheet", "listSheet"].forEach(function (id) {
    $(id).addEventListener("click", function (e) { if (e.target === this) this.classList.add("hidden"); });
  });

  // ---------- 오른쪽 버튼 ----------
  function setFollow(on) {
    follow = on;
    $("followBtn").classList.toggle("active", on);
    if (on && current) map.panTo(current);
  }
  $("followBtn").onclick = function () { setFollow(!follow); };
  map.on("dragstart", function () { setFollow(false); });

  $("clearBtn").onclick = function () {
    if (!confirm("지나온 길을 지울까요? (평가는 지워지지 않아요)")) return;
    track = [];
    trackLine.setLatLngs(track);
    saveTrack();
    toast("지나온 길을 지웠어요.");
  };

  // ---------- 알림 ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add("hidden"); }, 2800);
  }

  // ---------- 시작 ----------
  Store.onChange(renderRatings);
  Store.init();
  if (DEMO) startDemo(); else startGps();
})();

// 데이터 저장 / 로그인 담당.
// - FIREBASE_CONFIG 가 있으면: Google 로그인 + Firestore(모든 사용자 공유)
// - 없으면: 로그인 불가, 이 브라우저(localStorage)에만 저장
//
// 공통 인터페이스
//   canLogin                      로그인 가능 여부
//   onAuth(cb)                    cb(user | null), user = { uid, name }
//   signIn() / signOut()
//   subscribeReviews(cb)          cb(reviews[])
//   addReview(review, photo?)     → id   (photo = "data:image/jpeg;base64,..." 문자열)
//   deleteReview(id)
//   getPhoto(id)                  → dataURL | null
//   listMyReviews(uid)            → 내가 쓴 글 (최신순)
//   loadProfile(uid) / saveProfile(uid, data)
import { FIREBASE_CONFIG } from "./config.js?v=202611100554";

export async function createBackend() {
  if (FIREBASE_CONFIG) {
    try { return await firebaseBackend(FIREBASE_CONFIG); }
    catch (e) { console.warn("Firebase 연결 실패 → 로컬 저장 사용", e); }
  }
  return localBackend();
}

// ---------------- 로컬 (Firebase 없이) ----------------
function localBackend() {
  const R_KEY = "walkmap.reviews.v2";
  const P_KEY = "walkmap.photos.v2";
  const listeners = new Set();
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v)); // 용량 초과 시 예외 → 호출부에서 처리
  const emit = () => listeners.forEach((cb) => cb(read(R_KEY, [])));

  return {
    mode: "local",
    canLogin: false,
    onAuth(cb) { cb(null); },
    async signIn() { throw new Error("로그인하려면 config.js 에 Firebase 설정이 필요해요."); },
    async signOut() {},
    subscribeReviews(cb) { listeners.add(cb); cb(read(R_KEY, [])); return () => listeners.delete(cb); },
    async addReview(review, photo) {
      const id = crypto.randomUUID();
      if (photo) { const photos = read(P_KEY, {}); photos[id] = photo; write(P_KEY, photos); }
      const list = read(R_KEY, []);
      list.push({ ...review, id });
      write(R_KEY, list);
      emit();
      return id;
    },
    async deleteReview(id) {
      write(R_KEY, read(R_KEY, []).filter((r) => r.id !== id));
      const photos = read(P_KEY, {}); delete photos[id]; write(P_KEY, photos);
      emit();
    },
    async getPhoto(id) { return read(P_KEY, {})[id] || null; },
    async listMyReviews(uid) {
      return read(R_KEY, []).filter((r) => r.authorId === uid).sort((a, b) => b.createdAt - a.createdAt);
    },
    async loadProfile() { return null; },
    async saveProfile() {},
  };
}

// ---------------- Firebase ----------------
async function firebaseBackend(config) {
  const V = "10.12.2";
  const base = `https://www.gstatic.com/firebasejs/${V}`;
  const [{ initializeApp }, fs, au] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
    import(`${base}/firebase-auth.js`),
  ]);
  const app = initializeApp(config);
  const db = fs.getFirestore(app);
  const auth = au.getAuth(app);
  const reviewsCol = fs.collection(db, "reviews");
  await au.getRedirectResult(auth).catch(() => {}); // 모바일 리다이렉트 로그인 복귀 처리

  return {
    mode: "firebase",
    canLogin: true,
    onAuth(cb) {
      return au.onAuthStateChanged(auth, (u) =>
        cb(u ? { uid: u.uid, name: u.displayName || u.email || "사용자" } : null));
    },
    async signIn() {
      const provider = new au.GoogleAuthProvider();
      try {
        await au.signInWithPopup(auth, provider);
      } catch (e) {
        // 팝업이 막히는 환경(일부 모바일 브라우저)은 리다이렉트로 재시도
        if (["auth/popup-blocked", "auth/operation-not-supported-in-environment"].includes(e.code)) {
          await au.signInWithRedirect(auth, provider);
        } else if (e.code !== "auth/popup-closed-by-user") {
          throw e;
        }
      }
    },
    signOut: () => au.signOut(auth),

    subscribeReviews(cb) {
      const q = fs.query(reviewsCol, fs.orderBy("createdAt", "desc"), fs.limit(500));
      return fs.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    },
    async addReview(review, photo) {
      const ref = await fs.addDoc(reviewsCol, review);
      // 사진은 별도 컬렉션에 저장 → 목록을 불러올 때 사진까지 내려받지 않음
      if (photo) await fs.setDoc(fs.doc(db, "photos", ref.id), { data: photo });
      return ref.id;
    },
    async deleteReview(id) {
      await fs.deleteDoc(fs.doc(db, "photos", id)).catch(() => {});
      await fs.deleteDoc(fs.doc(db, "reviews", id));
    },
    async listMyReviews(uid) {
      // where 하나만 쓰면 추가 색인 없이 동작 → 정렬은 받아와서 함
      const q = fs.query(reviewsCol, fs.where("authorId", "==", uid), fs.limit(500));
      const snap = await fs.getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt);
    },
    async getPhoto(id) {
      const snap = await fs.getDoc(fs.doc(db, "photos", id));
      return snap.exists() ? snap.data().data : null;
    },
    async loadProfile(uid) {
      const snap = await fs.getDoc(fs.doc(db, "users", uid));
      return snap.exists() ? snap.data() : null;
    },
    saveProfile: (uid, data) => fs.setDoc(fs.doc(db, "users", uid), data, { merge: true }),
  };
}

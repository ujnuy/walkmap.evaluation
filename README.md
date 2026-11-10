# 🚶 길걸음 (Walk Map)

내 위치를 지도에 실시간으로 보여주고, 지나온 길을 색으로 그려주는 웹앱입니다.
걷는 사람은 도트(SD) 캐릭터로 표시되고, 지금 있는 길에 **편해요 / 불편해요**를 누르거나 코멘트를 남길 수 있습니다.

## 기능
- 🚪 시작 화면: **Google로 로그인하기** / **게스트로 시작하기**
  - 로그인: 지나온 길·캐릭터 설정이 계정에 백업되고, 내가 쓴 글이 계정에 연결돼요 (다른 기기에서도 "내 글"로 보이고 삭제 가능)
  - 게스트: 평가·코멘트는 지도에 남지만 작성자 정보는 저장하지 않아요. 사이트(탭)를 닫으면 내가 쓴 글인지 알 수 없게 돼요
- 🎨 캐릭터 꾸미기: 로그인/게스트를 고른 뒤 **헤어스타일 5 · 피부색 5 · 옷 5**종을 조합 (🎲 랜덤, ☰ 메뉴에서 언제든 변경, 로그인 시 계정에 저장)
- 📍 지도는 GPS로 찾은 **현재 위치**에서 시작 + 따라가기(◎)
- 🟧 지나온 길을 주황색 선으로 표시 (⌫로 지우기)
- 🛣️ 지금 서 있는 길 이름 자동 인식 (OpenStreetMap Nominatim)
- 📢 **민원 넣기**: "불편해요"를 고르면 위치·코멘트·사진으로 안전신문고 신고 문안을 자동으로 만들어 복사하고 안전신문고로 이동
- 📝 **내가 평가한 코멘트** (오른쪽 버튼): 로그인 사용자의 평가를 모아 보기 · 지도에서 보기 · 삭제. 게스트 평가는 지도에만 남고 이 목록에는 저장되지 않아요
- 🗺️ **자유모드**: 내 위치가 아니어도 지도를 움직여 십자 표시에 맞춘 길을 평가 (지도를 탭하면 그 지점으로 이동)
- 😊/😣 평가 + 💬 코멘트 + 📷 **사진 첨부** → 지도에 초록/빨강 점으로 표시 (내 글은 주황 테두리)

## 파일 구조
| 파일 | 설명 |
|---|---|
| `index.html` | 화면 구성 (시작 화면, 메뉴, 지도, 평가 패널) |
| `style.css` | 디자인 (도트 스타일) |
| `app.js` | 지도, 위치 추적, 로그인/게스트, 평가·사진 로직 |
| `sprite.js` | 도트 캐릭터 파츠 (헤어·피부·옷 픽셀 그림을 여기서 수정/추가) |
| `backend.js` | 로그인 + 저장 (Firebase 또는 localStorage) |
| `config.js` | 설정 (Firebase, 선 색상, GPS 필터) |

## GitHub Pages로 배포하기
1. GitHub에서 새 저장소를 만들고 이 폴더의 파일을 올립니다.
2. 저장소 **Settings → Pages → Branch: `main` / `(root)`** 선택 후 Save
3. 잠시 후 `https://<아이디>.github.io/<저장소이름>/` 으로 접속
4. 휴대폰에서 열고 **위치 권한 허용** (GPS는 HTTPS에서만 동작하는데, GitHub Pages는 HTTPS라 OK)

PC에서 테스트할 때는 주소 뒤에 `?demo` 를 붙이면 가상으로 걸어다닙니다.

## 로컬에서 실행
```bash
python3 -m http.server 8000
```
→ http://localhost:8000 (localhost는 HTTPS 없이도 위치 사용 가능)

## 로그인 + 평가 공유 켜기 (Firebase, 무료)
`config.js`가 비어 있으면 **로그인 버튼이 비활성화**되고, 평가는 내 브라우저에만 저장돼요.
GitHub Pages는 서버가 없으므로 로그인·공유에는 Firebase(무료 Spark 플랜)를 씁니다.

1. https://console.firebase.google.com 에서 프로젝트 생성
2. **Build → Authentication → 시작하기 → Sign-in method → Google** 사용 설정
3. **Authentication → Settings → 승인된 도메인**에 `<아이디>.github.io` 추가
4. **Build → Firestore Database** 만들기
5. 프로젝트 설정 → 웹 앱 추가 → 나온 설정값을 `config.js`의 `FIREBASE_CONFIG`에 붙여넣기
6. Firestore **규칙** 탭에 아래 내용을 붙여넣고 게시:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {

    // 평가/코멘트: 누구나 읽기, 게스트는 authorId=null 로만, 로그인 사용자는 본인 uid 로만 작성
    match /reviews/{id} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasOnly(
                         ['lat','lng','road','rating','comment','hasPhoto','authorId','createdAt'])
                    && request.resource.data.lat is number
                    && request.resource.data.lng is number
                    && request.resource.data.comment is string
                    && request.resource.data.comment.size() <= 200
                    && (request.resource.data.authorId == null
                        || (request.auth != null && request.resource.data.authorId == request.auth.uid));
      allow delete: if request.auth != null && resource.data.authorId == request.auth.uid;
      allow update: if false;
    }

    // 사진: 압축된 JPEG(약 600KB 이하)를 리뷰와 같은 id로 저장
    match /photos/{id} {
      allow read: if true;
      allow create: if get(/databases/$(db)/documents/reviews/$(id)).data.hasPhoto == true
                    && request.resource.data.keys().hasOnly(['data'])
                    && request.resource.data.data is string
                    && request.resource.data.data.size() < 800000;
      allow delete: if request.auth != null
                    && get(/databases/$(db)/documents/reviews/$(id)).data.authorId == request.auth.uid;
    }

    // 로그인 사용자의 백업 (지나온 길, 캐릭터): 본인만 읽기/쓰기
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

> Firebase 웹 설정값(apiKey 등)은 공개되어도 되는 값이에요. 보안은 위 규칙으로 지킵니다.
>
> 사진은 앱에서 긴 변 800px JPEG로 압축해 Firestore에 저장해요. Firebase Storage는 유료 플랜이 필요해서 쓰지 않았어요.

## 참고
- 지도: [Leaflet](https://leafletjs.com) + OpenStreetMap
- 길 이름 조회는 Nominatim 이용 정책에 따라 25m 이상 이동 & 5초 간격으로만 요청합니다. 사용자가 많아지면 카카오/네이버 지도 API로 바꾸는 것을 권장합니다.

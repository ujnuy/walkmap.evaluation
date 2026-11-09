# 걷기 지도 (walkmap)

걸으면서 내가 지나온 길을 지도에 그리고, 지금 있는 길이 걷기에 편한지·불편한지 평가와 코멘트를 남기는 웹앱입니다.
빌드 과정 없이 GitHub Pages에 그대로 올려서 쓸 수 있어요.

## 기능

- 내 위치를 GPS로 찾아 SD 도트 캐릭터로 표시 (걸으면 다리를 움직이며 통통 튀어요)
- 지나온 길을 주황색 선으로 표시 (새로고침해도 유지, ⌫ 버튼으로 지우기)
- ◎ 버튼: 내 위치 따라가기 켜기/끄기
- 화면 위쪽에 지금 있는 길 이름 표시 (누르면 그 길의 코멘트 목록)
- 😊 편해요 / 😣 불편해요 + 코멘트(200자) 남기기 → 지도에 초록·빨강 점으로 표시

## 파일 구성

| 파일 | 내용 |
|---|---|
| `index.html` | 화면 구조 |
| `style.css` | 도트 스타일 디자인 |
| `app.js` | 지도, 위치 추적, 평가 기능 |
| `sprite.js` | 캐릭터 픽셀 그림 (글자 배열을 고치면 캐릭터가 바뀜) |
| `storage.js` | 평가 저장 (기기 저장 또는 Firebase) |
| `config.js` | 설정값 (시작 위치, Firebase 등) |

## GitHub Pages로 배포하기

1. GitHub에서 새 저장소를 만들고 **Public**으로 설정합니다.
2. 저장소 화면에서 **uploading an existing file**을 눌러 위 파일들을 끌어다 놓고 **Commit changes**를 누릅니다.
   (폴더째가 아니라 파일들을 올려서 `index.html`이 저장소 맨 바깥에 있어야 해요.)
3. **Settings → Pages → Branch**를 `main` / `(root)`로 정하고 **Save**.
4. 몇 분 뒤 `https://아이디.github.io/저장소이름/` 으로 접속합니다.
5. 휴대폰에서 열고 위치 권한을 허용하면 끝!

PC에서 확인할 때는 주소 끝에 `?demo`를 붙이면 캐릭터가 가상으로 걸어다녀요.

## 다른 사람의 평가도 함께 보기 (선택)

기본 설정에서는 평가가 **내 휴대폰(브라우저)에만** 저장됩니다.
여러 사람이 평가를 공유하려면 무료 Firebase를 연결하세요.

1. https://console.firebase.google.com 에서 프로젝트 만들기
2. **Firestore Database** 만들기 (프로덕션 모드, 위치는 asia-northeast3 서울 추천)
3. 프로젝트 설정 → 내 앱 → 웹 앱(`</>`) 추가 → 나오는 `apiKey`, `authDomain`, `projectId`, `appId`를 `config.js`에 붙여 넣기
4. Firestore → **규칙** 탭에 아래 내용을 넣고 게시

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /ratings/{id} {
      allow read: if true;
      allow create: if request.resource.data.rating in ['good', 'bad']
                    && request.resource.data.comment is string
                    && request.resource.data.comment.size() <= 200;
      allow update, delete: if false;
    }
  }
}
```

이 규칙은 누구나 평가를 읽고 새로 남길 수는 있지만, 남의 평가를 고치거나 지울 수는 없게 합니다.

## 참고

- 지도와 길 이름은 OpenStreetMap / Nominatim 데이터를 사용합니다. 국내 골목길은 이름이 없을 수 있어요.
- GPS는 HTTPS 주소에서만 동작합니다. (GitHub Pages는 HTTPS라서 괜찮아요.)

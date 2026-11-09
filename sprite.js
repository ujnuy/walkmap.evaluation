// SD(2등신) 도트 캐릭터. 12x16 픽셀을 SVG 사각형으로 그립니다.
// 문자 하나 = 픽셀 하나. 색은 PALETTE 에서 바꿀 수 있어요.
const PALETTE = {
  K: "#1f1f1f", // 외곽선
  H: "#5b3a29", // 머리카락
  S: "#ffd9b3", // 피부
  E: "#1f1f1f", // 눈
  R: "#ff9aa2", // 볼터치
  M: "#c2410c", // 입
  B: "#3b82f6", // 남자 옷
  P: "#374151", // 바지
  D: "#ec4899", // 여자 원피스
  N: "#e11d48", // 리본
  W: "#111111", // 신발
};

const CHARACTERS = {
  // 남자: 짧은 머리, 파란 티셔츠, 바지
  m: {
    body: [
      "...KKKKKK...",
      "..KHHHHHHK..",
      ".KHHHHHHHHK.",
      ".KHHHHHHHHK.",
      ".KHSSSSSSHK.",
      ".KSSESSESSK.",
      ".KSSESSESSK.",
      ".KSRSSSSRSK.",
      "..KSSMMSSK..",
      "...KKKKKK...",
      "..KBBBBBBK..",
      ".KSBBBBBBSK.",
      "..KBBBBBBK..",
      "..KPPKKPPK..",
    ],
    legs: {
      stand: ["..KPK..KPK..", "..WWW..WWW.."],
      a:     [".KPK....KPK.", ".WWW....WWW."],
      b:     ["...KPKKPK...", "...WWWWWW..."],
    },
  },
  // 여자: 긴 머리 + 리본, 분홍 원피스
  f: {
    body: [
      "...KKKKNN...",
      "..KHHHHHNNK.",
      ".KHHHHHHHHK.",
      ".KHHHHHHHHK.",
      ".KHSSSSSSHK.",
      ".KHSESSESHK.",
      ".KHSESSESHK.",
      ".KHRSSSSRHK.",
      ".KHKSMMSKHK.",
      ".KHHKKKKHHK.",
      "..KDDDDDDK..",
      ".KSDDDDDDSK.",
      ".KDDDDDDDDK.",
      "..KKKKKKKK..",
    ],
    legs: {
      stand: ["...KS..SK...", "...WW..WW..."],
      a:     ["..KS....SK..", "..WW....WW.."],
      b:     ["....KSSK....", "....WWWW...."],
    },
  },
};

function toSvg(rows, cls, w = 36, h = 48) {
  let rects = "";
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const c = PALETTE[ch];
      if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    });
  });
  return `<svg class="${cls}" viewBox="0 0 12 16" width="${w}" height="${h}" shape-rendering="crispEdges">${rects}</svg>`;
}

/** 지도 마커용 (서기 / 걷기 A / 걷기 B 프레임) */
export function walkerHtml(gender = "m") {
  const c = CHARACTERS[gender] || CHARACTERS.m;
  return `<div class="sprite">
    ${toSvg([...c.body, ...c.legs.stand], "f-stand")}
    ${toSvg([...c.body, ...c.legs.a], "f-a")}
    ${toSvg([...c.body, ...c.legs.b], "f-b")}
  </div><div class="shadow"></div>`;
}

/** 캐릭터 선택 화면용 미리보기 */
export function previewSvg(gender = "m", scale = 4) {
  const c = CHARACTERS[gender] || CHARACTERS.m;
  return toSvg([...c.body, ...c.legs.stand], "preview", 12 * scale, 16 * scale);
}

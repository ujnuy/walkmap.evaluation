// SD(2등신) 도트 캐릭터 — 헤어 5 × 피부 5 × 옷 5 조합.
// 12x16 픽셀. 얼굴(0~9행) + 옷(10~13행) + 다리(14~15행) 위에 헤어를 덧그려서 만듭니다.
//
// 그림 글자:  .  투명(아래 레이어 유지)   _  강제로 지우기(헤어용)
//   K 외곽선  E 눈  M 입  W 신발  S 피부  R 볼터치  H 머리카락
//   A/B/C/D 옷 색 (옷마다 다름)

const FIXED = { K: "#1f1f1f", E: "#1f1f1f", M: "#c2410c", W: "#111111", H: "#5b3a29" };

// ---------- 얼굴 (머리카락 없는 상태) ----------
const FACE = [
  "...KKKKKK...",
  "..KSSSSSSK..",
  ".KSSSSSSSSK.",
  ".KSSSSSSSSK.",
  ".KSSSSSSSSK.",
  ".KSSESSESSK.",
  ".KSSESSESSK.",
  ".KSRSSSSRSK.",
  "..KSSMMSSK..",
  "...KKKKKK...",
];

// ---------- 헤어스타일 5종 (위에서부터 덮어씀) ----------
export const HAIRS = [
  {
    name: "짧은머리",
    rows: [
      "...KKKKKK...",
      "..KHHHHHHK..",
      ".KHHHHHHHHK.",
      ".KHHHHHHHHK.",
      "..H......H..",
    ],
  },
  {
    name: "뾰족머리",
    rows: [
      "__K_K__K_K__",
      "_KHKHKKHKHK_",
      ".KHHHHHHHHK.",
      ".KHHHHHHHHK.",
      "..H......H..",
    ],
  },
  {
    name: "단발",
    rows: [
      "...KKKKKK...",
      "..KHHHHHHK..",
      ".KHHHHHHHHK.",
      ".KHHHHHHHHK.",
      ".KHH....HHK.",
      ".KH......HK.",
      ".KH......HK.",
      ".KH......HK.",
      ".KHK....KHK.",
      "..KK....KK..",
    ],
  },
  {
    name: "긴머리",
    rows: [
      "...KKKKKK...",
      "..KHHHHHHK..",
      ".KHHHHHHHHK.",
      ".KHHHHHHHHK.",
      ".KH......HK.",
      ".KH......HK.",
      ".KH......HK.",
      ".KH......HK.",
      ".KHK....KHK.",
      ".KHH....HHK.",
      ".KH......HK.",
      ".KH......HK.",
    ],
  },
  {
    name: "양갈래",
    rows: [
      "...KKKKKK...",
      "..KHHHHHHK..",
      ".KHHHHHHHHK.",
      "KKHHHHHHHHKK",
      "HKH......HKH",
      "HK........KH",
      "HK........KH",
      "K..........K",
    ],
  },
];

// ---------- 피부색 5종 [피부, 볼터치] ----------
export const SKINS = [
  { name: "아주 밝게", S: "#ffe6d0", R: "#ffa8b0" },
  { name: "밝게",     S: "#f7cfa6", R: "#f59a9a" },
  { name: "중간",     S: "#e0aa7c", R: "#e08a7a" },
  { name: "구릿빛",   S: "#b97c50", R: "#c46a5a" },
  { name: "어둡게",   S: "#7a4b2c", R: "#9c4e44" },
];

// ---------- 옷 5종 ----------
const PANTS_LEGS = {
  stand: ["..KBK..KBK..", "..WWW..WWW.."],
  a:     [".KBK....KBK.", ".WWW....WWW."],
  b:     ["...KBKKBK...", "...WWWWWW..."],
};
const BARE_LEGS = {
  stand: ["...KS..SK...", "...WW..WW..."],
  a:     ["..KS....SK..", "..WW....WW.."],
  b:     ["....KSSK....", "....WWWW...."],
};

export const OUTFITS = [
  {
    name: "티셔츠",
    colors: { A: "#3b82f6", B: "#374151" },
    body: ["..KAAAAAAK..", ".KSAAAAAASK.", "..KAAAAAAK..", "..KBBKKBBK.."],
    legs: PANTS_LEGS,
  },
  {
    name: "후드티",
    colors: { A: "#22c55e", C: "#15803d", B: "#1e40af" },
    body: ["..KCAAAACK..", ".KSAAAAAASK.", "..KACCCCAK..", "..KBBKKBBK.."],
    legs: PANTS_LEGS,
  },
  {
    name: "원피스",
    colors: { A: "#ec4899" },
    body: ["..KAAAAAAK..", ".KSAAAAAASK.", ".KAAAAAAAAK.", "..KKKKKKKK.."],
    legs: BARE_LEGS,
  },
  {
    name: "정장",
    colors: { A: "#1f2a44", C: "#ffffff", D: "#dc2626", B: "#1f2a44" },
    body: ["..KACDDCAK..", ".KSAADDAASK.", "..KAAAAAAK..", "..KBBKKBBK.."],
    legs: PANTS_LEGS,
  },
  {
    name: "운동복",
    colors: { A: "#ef4444", C: "#ffffff", B: "#ef4444" },
    body: ["..KAACCAAK..", ".KSAACCAASK.", "..KAACCAAK..", "..KBBKKBBK.."],
    legs: PANTS_LEGS,
  },
];

export const DEFAULT_CHARACTER = { hair: 0, skin: 1, outfit: 0 };

/** 저장된 값이 이상해도 항상 올바른 캐릭터를 돌려줌 (예전 여/남 설정도 변환) */
export function normalizeCharacter(c) {
  if (c === "f") return { hair: 3, skin: 1, outfit: 2 };
  if (c === "m") return { ...DEFAULT_CHARACTER };
  const pick = (v, list, d) => (Number.isInteger(v) && v >= 0 && v < list.length ? v : d);
  return {
    hair: pick(c?.hair, HAIRS, DEFAULT_CHARACTER.hair),
    skin: pick(c?.skin, SKINS, DEFAULT_CHARACTER.skin),
    outfit: pick(c?.outfit, OUTFITS, DEFAULT_CHARACTER.outfit),
  };
}

function compose(c, frame) {
  const outfit = OUTFITS[c.outfit];
  const grid = [...FACE, ...outfit.body, ...outfit.legs[frame]].map((r) => [...r]);
  HAIRS[c.hair].rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === "_") grid[y][x] = ".";
      else if (ch !== ".") grid[y][x] = ch;
    });
  });
  return grid;
}

function toSvg(c, frame, cls, w, h) {
  c = normalizeCharacter(c);
  const palette = { ...FIXED, S: SKINS[c.skin].S, R: SKINS[c.skin].R, ...OUTFITS[c.outfit].colors };
  let rects = "";
  compose(c, frame).forEach((row, y) => {
    row.forEach((ch, x) => {
      const color = palette[ch];
      if (color) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`;
    });
  });
  return `<svg class="${cls}" viewBox="0 0 12 16" width="${w}" height="${h}" shape-rendering="crispEdges">${rects}</svg>`;
}

/** 지도 마커용 (서기 / 걷기 A / 걷기 B 프레임) */
export function walkerHtml(c, scale = 3) {
  const w = 12 * scale, h = 16 * scale;
  return `<div class="sprite" style="width:${w}px;height:${h}px">
    ${toSvg(c, "stand", "f-stand", w, h)}
    ${toSvg(c, "a", "f-a", w, h)}
    ${toSvg(c, "b", "f-b", w, h)}
  </div><div class="shadow"></div>`;
}

/** 서 있는 모습 한 장 (선택 버튼용) */
export function previewSvg(c, scale = 4) {
  return toSvg(c, "stand", "preview", 12 * scale, 16 * scale);
}

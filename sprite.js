// SD 도트 캐릭터 (가로 12칸 × 세로 16칸)
// 글자 하나가 픽셀 하나입니다. 글자를 바꾸면 캐릭터 모양이 바뀌어요.
//  .  투명    K  외곽선    H  머리카락   S  피부
//  W  눈 하이라이트  P  볼터치   R  옷   B  바지   O  신발

window.SPRITE = (function () {
  const PALETTE = {
    K: "#1d2b53",
    H: "#5f3a1e",
    S: "#ffd7b5",
    W: "#ffffff",
    P: "#ff77a8",
    R: "#ff8c1a",
    B: "#29adff",
    O: "#7e2553"
  };

  const HEAD = [
    "...KKKKKK...",
    "..KHHHHHHKK.",
    ".KHHHHHHHHHK",
    ".KHHSSSSSHHK",
    ".KHSSSSSSSK.",
    ".KSSKSSSKSK.",
    ".KSSKSSSKSK.",
    ".KPSSSSSSPK.",
    "..KSSSSSSK..",
    "...KKKKKK...",
    "..KRRRRRRK..",
    ".KSRRRRRRSK.",
    "..KRRRRRRK..",
    "..KBBKKBBK.."
  ];

  const FRAMES = {
    idle: HEAD.concat([
      "..KBK..KBK..",
      "..KOOK.KOOK."
    ]),
    walk1: HEAD.concat([
      ".KBK....KBK.",
      ".KOOK...KOOK"
    ]),
    walk2: HEAD.concat([
      "...KBKKBK...",
      "...KOOKOOK.."
    ])
  };

  const SCALE = 3;

  function draw(rows) {
    const canvas = document.createElement("canvas");
    canvas.width = 12 * SCALE;
    canvas.height = 16 * SCALE;
    const ctx = canvas.getContext("2d");
    rows.forEach(function (row, y) {
      for (let x = 0; x < row.length; x++) {
        const color = PALETTE[row[x]];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
      }
    });
    return canvas.toDataURL("image/png");
  }

  const images = {};
  Object.keys(FRAMES).forEach(function (name) {
    images[name] = draw(FRAMES[name]);
  });

  return { images: images, frames: FRAMES };
})();

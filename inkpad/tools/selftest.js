#!/usr/bin/env node
/**
 * 离线自检：不接硬件也能验的部分
 *
 *   node tools/selftest.js
 *
 * 验三件事：
 *   1. CRC32 与 Node 内置 zlib.crc32 一致（固件里是自己实现的，必须对得上）
 *   2. 纯色帧的字节值正确（2bpp 每字节 4 像素，高位在前）
 *   3. 2bpp → 双平面的转换与固件 fillFrom2bpp 等价（用 JS 复刻一份对照）
 */

const zlib = require("zlib");
const { crc32, solidFrame, COLOR_LEN, W, H } = require("../app/serial");

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

// ── 1. CRC32 ────────────────────────────────────────────
console.log("\n[1] CRC32");
const samples = [
  Buffer.from(""),
  Buffer.from("123456789"),
  Buffer.alloc(COLOR_LEN, 0x55),
  Buffer.alloc(COLOR_LEN, 0x00),
  Buffer.alloc(COLOR_LEN, 0xff),
];
for (const buf of samples) {
  const mine = crc32(buf);
  const ref = zlib.crc32 ? zlib.crc32(buf) : null;
  if (ref === null) {
    console.log("  ! 当前 Node 无 zlib.crc32，跳过对照");
    break;
  }
  check(
    `${buf.length} 字节 → ${mine.toString(16).padStart(8, "0")}`,
    mine === ref,
    mine === ref ? "" : `期望 ${ref.toString(16)}`
  );
}

// ── 2. 纯色帧 ───────────────────────────────────────────
console.log("\n[2] 纯色帧");
check("帧长 30000", COLOR_LEN === 30000, `实际 ${COLOR_LEN}`);
check("尺寸 400×300", W === 400 && H === 300);
const expect = { black: 0x00, white: 0x55, yellow: 0xaa, red: 0xff };
for (const [color, byte] of Object.entries(expect)) {
  const f = solidFrame(color);
  const allSame = f.every((b) => b === byte);
  check(`${color} 全帧 0x${byte.toString(16).padStart(2, "0")}`, allSame, `首字节 0x${f[0].toString(16)}`);
}

// ── 3. 2bpp → 双平面（复刻固件 epdFrom2bpp）─────────────
console.log("\n[3] 2bpp → 双平面转换");
const FRAME_LEN = (W / 8) * H; // 15000

function from2bpp(src) {
  const bw = new Uint8Array(FRAME_LEN); // 默认 0（黑）
  const rd = new Uint8Array(FRAME_LEN).fill(0xff); // 默认无红
  let ob = 0;
  let ot = 0;
  for (let i = 0; i < COLOR_LEN; i++) {
    const s = src[i];
    for (let k = 0; k < 4; k++) {
      const code = (s >> (6 - k * 2)) & 0x03;
      if (code !== 0) bw[ob] |= 0x80 >> ot;
      if (code === 2 || code === 3) rd[ob] &= ~(0x80 >> ot);
      if (++ot === 8) {
        ot = 0;
        ob++;
      }
    }
  }
  return { bw, rd };
}

// 全白：bw 全 1、rd 全 1
{
  const { bw, rd } = from2bpp(solidFrame("white"));
  check("全白 → bw=0xFF / rd=0xFF", bw[0] === 0xff && rd[0] === 0xff);
}
// 全黑：bw 全 0、rd 全 1
{
  const { bw, rd } = from2bpp(solidFrame("black"));
  check("全黑 → bw=0x00 / rd=0xFF", bw[0] === 0x00 && rd[0] === 0xff);
}
// 全红：bw 全 1、rd 全 0
{
  const { bw, rd } = from2bpp(solidFrame("red"));
  check("全红 → bw=0xFF / rd=0x00", bw[0] === 0xff && rd[0] === 0x00);
}
// 逐像素检查：一行 400 像素 = 100 字节，前 100 黑 / 100 白 / 100 黄 / 100 红
{
  const row = Buffer.alloc(100);
  row.fill(0x00, 0, 25); // 像素 0..99   黑
  row.fill(0x55, 25, 50); // 像素 100..199 白
  row.fill(0xaa, 50, 75); // 像素 200..299 黄
  row.fill(0xff, 75, 100); // 像素 300..399 红
  const buf = Buffer.concat(Array.from({ length: H }, () => row));
  const { bw, rd } = from2bpp(buf);
  const bit = (arr, i) => (arr[i >> 3] >> (7 - (i & 7))) & 1;
  check("像素 0 黑 → bw=0", bit(bw, 0) === 0);
  check("像素 120 白 → bw=1", bit(bw, 120) === 1);
  check("像素 220 黄 → bw=1", bit(bw, 220) === 1);
  check("像素 220 黄 → rd=0", bit(rd, 220) === 0);
  check("像素 320 红 → bw=1", bit(bw, 320) === 1);
  check("像素 320 红 → rd=0", bit(rd, 320) === 0);
}

// ── 汇总 ────────────────────────────────────────────────
console.log(failed ? `\n失败 ${failed} 项\n` : "\n全部通过\n");
process.exit(failed ? 1 : 0);

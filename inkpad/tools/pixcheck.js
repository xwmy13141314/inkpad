/**
 * 像素诊断：解码 PNG，把指定区域打成 ASCII 灰度图 / 量化图，肉眼看丢了什么
 *
 * 用法：node tools/pixcheck.js <png> [x y w h]
 * 不带区域参数时打整幅（400x300 太大，慎用）
 */
const fs = require("fs");
const zlib = require("zlib");

// ── PNG 解码（8bit RGB，支持全部 5 种 filter；toPNG 产物用 Sub/Up）──
function decodePng(file) {
  const buf = fs.readFileSync(file);
  // 跳过 8 字节签名，遍历 chunk
  let off = 8;
  let w = 0, h = 0, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
    } else if (type === "IDAT") {
      idat.push(data);
    }
    off += 12 + len;
    if (type === "IEND") break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 3;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0; // 左
      const b = prev[i]; // 上
      const c = i >= bpp ? prev[i - bpp] : 0; // 左上
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    cur.copy(prev);
  }
  return { w, h, rgb: out };
}

const file = process.argv[2];
if (!file) {
  console.error("用法: node tools/pixcheck.js <png> [x y w h]");
  process.exit(1);
}
const img = decodePng(file);
let x = 0, y = 0, w = img.w, h = img.h;
if (process.argv.length >= 6) {
  x = +process.argv[3]; y = +process.argv[4]; w = +process.argv[5]; h = +process.argv[6];
}

// 灰度字符集：越黑字符越实
const RAMP = " .:-=+*#%@";
for (let yy = y; yy < y + h; yy++) {
  let line = "";
  for (let xx = x; xx < x + w; xx++) {
    const i = (yy * img.w + xx) * 3;
    const l = Math.round(0.299 * img.rgb[i] + 0.587 * img.rgb[i + 1] + 0.114 * img.rgb[i + 2]);
    line += RAMP[Math.min(9, Math.floor((255 - l) / 25.6))];
  }
  console.log(String(yy).padStart(3) + " " + line);
}
// 顺带统计：区域内半灰像素（会被 threshold 170 漂白成白的"灰区"）占比
let gray = 0, dark = 0, total = 0;
for (let yy = y; yy < y + h; yy++) {
  for (let xx = x; xx < x + w; xx++) {
    const i = (yy * img.w + xx) * 3;
    const l = 0.299 * img.rgb[i] + 0.587 * img.rgb[i + 1] + 0.114 * img.rgb[i + 2];
    total++;
    if (l >= 170) continue;
    if (l >= 100) gray++; else dark++;
  }
}
console.log(`\n区域 ${w}x${h} @(${x},${y})：黑(<100)=${dark} 半灰(100~170,量化后保黑)=${gray} 浅灰(>=170,量化后变白)未计入`);

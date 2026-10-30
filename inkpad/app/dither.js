/**
 * 三色量化：RGBA 像素 → 2bpp
 *
 * 调色板（与固件、协议一致）：0=黑 1=白 2=黄 3=红
 * 本屏没有黄色，code 2 会显示成红；保留这个编码是为了将来换四色屏不用改协议。
 *
 * 两种模式：
 *   threshold  纯阈值。文字、线条、UI 用这个，边缘最锐利，不会出现噪点。
 *   fs         Floyd–Steinberg 误差扩散。照片用这个，靠疏密表现灰阶。
 *
 * 红色单独判断，不参与抖动：否则红色区域会被抖成红白噪点，很脏。
 */

const BLACK = 0;
const WHITE = 1;
const YELLOW = 2;
const RED = 3;

/** 判断一个像素是否该归为「红」 */
function isReddish(r, g, b, redRatio, redMin) {
  return r > redMin && r > g * redRatio && r > b * redRatio;
}

/**
 * @param {Uint8ClampedArray|Uint8Array} rgba  长度 w*h*4
 * @param {number} w
 * @param {number} h
 * @param {object} [opts]
 * @param {'threshold'|'fs'} [opts.mode='threshold']
 * @param {number} [opts.threshold=170]     亮度阈值，越大越偏黑（字越粗）
 * @param {number} [opts.redRatio=1.45]     红色判定：r 要大于 g/b 的这个倍数
 * @param {number} [opts.redMin=60]         红色判定的最低亮度，避免深灰被当成红
 * @param {number} [opts.contrast=1]        对比度系数，量化前先拉一次对比（照片用）
 * @returns {Uint8Array} 长度 (w*h)/4 的 2bpp 数据
 */
function to2bpp(rgba, w, h, opts = {}) {
  const {
    mode = "threshold",
    threshold = 170,
    redRatio = 1.45,
    redMin = 60,
    contrast = 1,
  } = opts;

  const n = w * h;
  const lum = new Float32Array(n);
  const red = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    if (isReddish(r, g, b, redRatio, redMin)) {
      red[i] = 1;
      lum[i] = 0;
    } else {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      // 量化前拉对比：中间灰会被推开，照片不会糊成一片浅灰
      lum[i] = contrast === 1 ? l : Math.max(0, Math.min(255, (l - 128) * contrast + 128));
    }
  }

  // 先定每个像素的最终编码
  const code = new Uint8Array(n);

  if (mode === "fs") {
    // Floyd–Steinberg：横向扫描，误差扩散到右/左下/下/右下。
    // 注意不要把误差乘系数来"调强度"——那会系统性偏亮，照片发灰。
    // 想要更硬朗就调 contrast，不要动扩散比例。
    const push = (idx, err, factor) => {
      if (idx < 0 || idx >= n) return;
      if (red[idx]) return; // 红色像素不吃误差，避免把红区抖脏
      lum[idx] += err * factor;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (red[i]) {
          code[i] = RED;
          continue;
        }
        const old = lum[i];
        const isWhite = old >= threshold;
        code[i] = isWhite ? WHITE : BLACK;
        const err = old - (isWhite ? 255 : 0);
        const hasRight = x + 1 < w;
        const hasLeft = x > 0;
        const hasDown = y + 1 < h;
        if (hasRight) push(i + 1, err, 7 / 16);
        if (hasDown) {
          if (hasLeft) push(i + w - 1, err, 3 / 16);
          push(i + w, err, 5 / 16);
          if (hasRight) push(i + w + 1, err, 1 / 16);
        }
      }
    }
  } else {
    for (let i = 0; i < n; i++) {
      code[i] = red[i] ? RED : lum[i] >= threshold ? WHITE : BLACK;
    }
  }

  // 打包成 2bpp，每字节 4 像素，高位在前
  const out = new Uint8Array((w * h) / 4);
  for (let i = 0, o = 0, shift = 6; i < n; i++, shift -= 2) {
    if (shift < 0) {
      o++;
      shift = 6;
    }
    out[o] |= code[i] << shift;
  }
  return out;
}

/** 统计各色占比，用于自检和调试 */
function histogram(rgba, w, h, opts = {}) {
  const buf = to2bpp(rgba, w, h, opts);
  const counts = { black: 0, white: 0, yellow: 0, red: 0 };
  const names = ["black", "white", "yellow", "red"];
  for (const byte of buf) {
    for (let s = 6; s >= 0; s -= 2) counts[names[(byte >> s) & 3]]++;
  }
  return counts;
}

module.exports = { to2bpp, histogram, BLACK, WHITE, YELLOW, RED };

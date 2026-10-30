/**
 * 离屏渲染：把模板 HTML 按屏幕真实像素渲染出来，取回像素
 *
 * 为什么用离屏窗口而不是 canvas 库：
 *   模板就是 HTML/CSS，改风格等于改样式；预览和上屏用同一份文件，
 *   不存在"预览好看、上屏难看"的对不上。
 *
 * 这个环境里踩过的坑（全是硬崩，无异常日志、退出码 127）：
 *   1. 反复创建/销毁离屏窗口会崩 → 全程复用一个窗口，不销毁
 *   2. NativeImage 在窗口销毁后再读会崩 → 像素在窗口存活时立刻拷出来
 *   3. capturePage() 会崩 → 只能用 offscreen + paint 事件
 *   4. enableDeviceEmulation() 会崩 → 改用全局 force-device-scale-factor=1
 *   5. nativeImage.createFromBitmap() 会崩 → 自己写 PNG 编码器（app/png.js）
 */

const { BrowserWindow } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { to2bpp } = require("./dither");
const { encodePng } = require("./png");

const DEFAULT_W = 400;
const DEFAULT_H = 300;

// 预览用配色。黄用橄榄色标出来，方便一眼看出"这里出现了不该有的 code 2"；
// 实际这块屏没有黄色，code 2 会显示成红。
const PREVIEW_COLORS = [
  [0x00, 0x00, 0x00], // 0 黑
  [0xff, 0xff, 0xff], // 1 白
  [0xb8, 0x86, 0x00], // 2 黄
  [0xc0, 0x20, 0x20], // 3 红
];

let sharedWin = null;
let latestImage = null;
let winW = 0;
let winH = 0;

/** 复用一个离屏窗口。销毁重建会崩，所以只建一次。 */
function ensureWindow(w, h) {
  if (sharedWin && !sharedWin.isDestroyed() && winW === w && winH === h) return sharedWin;

  if (sharedWin && !sharedWin.isDestroyed()) {
    try {
      sharedWin.destroy();
    } catch (_) {}
    sharedWin = null;
  }

  winW = w;
  winH = h;
  latestImage = null;

  sharedWin = new BrowserWindow({
    show: false,
    width: w,
    height: h,
    frame: false,
    transparent: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      // 相框模板要用 file:// 引用本地图片。只渲染我们自己写的模板，不放外部内容进来。
      webSecurity: false,
    },
  });

  sharedWin.webContents.setFrameRate(30);
  sharedWin.webContents.on("paint", (_e, _dirty, image) => {
    const s = image.getSize();
    if (s.width === w && s.height === h) latestImage = image;
  });

  return sharedWin;
}

/** 判断图像是不是纯色空白（全白/全黑），用于识别"截到空白帧" */
function isBlank(image) {
  const bgra = image.toBitmap();
  const first = bgra[0];
  for (let i = 4; i < bgra.length; i += 4) {
    if (Math.abs(bgra[i] - first) > 8) return false;
  }
  return true;
}

/**
 * 渲染一段 HTML，返回拷贝好的像素缓冲
 * @returns {Promise<{png: Buffer, bgra: Buffer, width: number, height: number}>}
 */
async function renderHtml(html, w = DEFAULT_W, h = DEFAULT_H, timeoutMs = 10000, onStep = () => {}) {
  const win = ensureWindow(w, h);
  latestImage = null;

  onStep("加载 HTML");
  // data: URL 有长度上限（内联大图会超过 2MB 被拒），超过阈值就落成临时文件再加载
  if (Buffer.byteLength(html, "utf8") > 200000) {
    const tmp = path.join(os.tmpdir(), `inkpad-render-${process.pid}.html`);
    fs.writeFileSync(tmp, html, "utf8");
    await win.loadFile(tmp);
  } else {
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  }
  onStep("HTML 已加载");

  // 等字体真正加载完，否则首次渲染会用回退字体
  await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)").catch(() => {});
  onStep("字体就绪");

  // 首帧可能在内容绘制前就带着全白画面触发，所以等到拿到非空白的帧
  const deadline = Date.now() + timeoutMs;
  let frames = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 60));
    if (latestImage) frames++;
    if (latestImage && !isBlank(latestImage)) break;
  }
  onStep(
    `收到帧 ${frames} 次，latest=${latestImage ? latestImage.getSize().width + "x" + latestImage.getSize().height : "null"}`
  );

  if (!latestImage) throw new Error("渲染超时：没拿到任何帧");
  if (isBlank(latestImage)) throw new Error("渲染失败：画面是空白的");

  // 渐进光栅化兜底：首帧非空 ≠ 所有 tile 画完，toPNG/toBitmap 偶发截到半截字；
  // 再固定等一段并持续接收 paint 更新，让光栅化收尾后取最终帧
  await new Promise((r) => setTimeout(r, 150));

  // ⚠ 必须趁窗口还活着把像素拷出来。NativeImage 背后是窗口的共享内存，
  // 一旦窗口销毁再调 toPNG()/toBitmap() 就是读已释放内存 → 全白图或直接崩。
  onStep("拷贝像素");
  const png = latestImage.toPNG();
  const bgra = Buffer.from(latestImage.toBitmap());
  onStep(`像素已拷贝 png=${png.length}B bgra=${bgra.length}B`);

  return { png, bgra, width: w, height: h };
}

/**
 * 渲染 HTML → PNG + 2bpp 帧
 * @returns {Promise<{png: Buffer, frame: Uint8Array, size: {width:number,height:number}}>}
 */
async function renderToFrame(html, opts = {}) {
  const w = opts.width || DEFAULT_W;
  const h = opts.height || DEFAULT_H;
  const onStep = opts.onStep || (() => {});
  const { png, bgra } = await renderHtml(html, w, h, opts.timeoutMs, onStep);

  // toBitmap 返回 BGRA（预乘 alpha）。模板背景是不透明白，alpha 恒为 255，直接换通道即可。
  const rgba = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2];
    rgba[i + 1] = bgra[i + 1];
    rgba[i + 2] = bgra[i];
    rgba[i + 3] = 255;
  }

  const frame = to2bpp(rgba, w, h, opts.dither || {});
  onStep("量化完成");
  return { png, frame, size: { width: w, height: h } };
}

/** 把 2bpp 帧反解成预览 PNG，用来判断量化后字到底清不清 */
function frameToPreviewPng(frame, w = DEFAULT_W, h = DEFAULT_H) {
  const rgb = Buffer.alloc(w * h * 3);
  const n = w * h;
  for (let i = 0, o = 0, shift = 6; i < n; i++, shift -= 2) {
    if (shift < 0) {
      o++;
      shift = 6;
    }
    const code = (frame[o] >> shift) & 3;
    const c = PREVIEW_COLORS[code];
    const p = i * 3;
    rgb[p] = c[0];
    rgb[p + 1] = c[1];
    rgb[p + 2] = c[2];
  }
  return encodePng(w, h, rgb);
}

/** 应用退出时清理 */
function dispose() {
  if (sharedWin && !sharedWin.isDestroyed()) {
    try {
      sharedWin.destroy();
    } catch (_) {}
  }
  sharedWin = null;
}

module.exports = { renderHtml, renderToFrame, frameToPreviewPng, dispose, DEFAULT_W, DEFAULT_H };

#!/usr/bin/env node
/**
 * 生成应用图标（在 Electron 里跑）
 *
 *   ./node_modules/.bin/electron tools/make-icon.js
 *
 * 产物：assets/icon.png（256×256）
 * 用离屏渲染画，和模板共用同一条渲染管线，不用另找绘图库。
 */

const { app } = require("electron");
const fs = require("fs");
const path = require("path");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.disableHardwareAcceleration();
app.setPath("userData", path.join(__dirname, "..", ".userdata"));

const { renderHtml } = require("../app/render");

const OUT = path.join(__dirname, "..", "assets");
fs.mkdirSync(OUT, { recursive: true });

// 一个"小屏幕"的意象：黑底圆角、白色屏幕、底部一条红色强调线。
// 不用文字，缩到 16×16 也认得出。
const SIZE = 256;
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${SIZE}px; height:${SIZE}px; background:#1d1d1b; }
  .app {
    width:${SIZE}px; height:${SIZE}px;
    background:#1d1d1b;
    border-radius:0;
    display:flex; align-items:center; justify-content:center;
  }
  .screen {
    width:148px; height:112px;
    background:#ffffff;
    border-radius:8px;
    position:relative;
    overflow:hidden;
    display:flex; flex-direction:column; justify-content:center;
    padding:0 14px;
  }
  .l1 { height:14px; background:#1d1d1b; border-radius:2px; width:78%; }
  .l2 { height:10px; background:#1d1d1b; border-radius:2px; width:52%; margin-top:9px; opacity:.55; }
  .accent {
    position:absolute; left:0; right:0; bottom:0;
    height:12px; background:#c02020;
  }
</style></head><body>
  <div class="app">
    <div class="screen">
      <div class="l1"></div>
      <div class="l2"></div>
      <div class="accent"></div>
    </div>
  </div>
</body></html>`;

app.whenReady().then(async () => {
  try {
    const { png } = await renderHtml(HTML, SIZE, SIZE, 8000, (s) => console.log("· " + s));
    const out = path.join(OUT, "icon.png");
    fs.writeFileSync(out, png);
    console.log("图标已生成：" + out + ` (${(png.length / 1024).toFixed(1)} KB)`);
    app.quit();
  } catch (e) {
    console.error("生成失败：" + e.message);
    app.exit(1);
  }
});

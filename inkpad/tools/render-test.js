#!/usr/bin/env node
/**
 * 渲染自检（在 Electron 里跑，不是 node）
 *
 *   ./node_modules/.bin/electron tools/render-test.js [模板名...]
 *
 * 不指定模板名就渲染全部。产物在 out/：
 *   <模板>.png        渲染原图（带抗锯齿）
 *   <模板>-quant.png  量化后的样子 = 屏上真实效果
 *   <模板>.bin        2bpp 帧，可直接推屏
 *   render-test.json  尺寸、耗时、各色占比
 */

const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "out");
fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG = path.join(OUT_DIR, "render-test.log");
fs.writeFileSync(LOG, "");

// Windows 上 Electron 是 GUI 子系统程序，main 进程的 stdout 常常接不到管道。
// 所以全程写日志文件，由外部读文件判断结果。
function say(msg) {
  fs.appendFileSync(LOG, msg + "\n");
}
say(`启动 ${new Date().toISOString()}`);

process.on("uncaughtException", (e) => {
  say("未捕获异常：" + (e && e.stack ? e.stack : e));
  app.exit(1);
});

// 必须在 ready 之前：否则高分屏会按 1.25/1.5 倍渲染，拿不到 400×300
app.commandLine.appendSwitch("force-device-scale-factor", "1");
// 关掉次像素抗锯齿（LCD text）。Windows 下字边缘会产生 RGB 彩色条纹，
// 被三色量化当成"红"，黑字上会出现红边。
app.commandLine.appendSwitch("disable-lcd-text");
// 离屏渲染在 Windows 上开着硬件加速会直接崩进程（无报错、退出码 127）
app.disableHardwareAcceleration();
// 独立 userData，避免和别的 Electron 实例抢缓存目录
app.setPath("userData", path.join(__dirname, "..", ".userdata"));

const { renderToFrame, frameToPreviewPng } = require("../app/render");
const { buildTemplate, TEMPLATES } = require("../app/templates");
const store = require("../app/store");
say("模块加载完成");

// 测试用假天气，避免自检依赖网络
const FAKE_WEATHER = {
  cache: { temp: 26, hi: 29, lo: 22, humidity: 70, cond: "多云", at: new Date().toISOString() },
  at: new Date().toISOString(),
};

app.whenReady().then(async () => {
  say("app ready");

  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const list = args.length ? args : TEMPLATES.map((t) => t.id);
  const data = store.get();
  // 自检时可以指定一张照片，不污染用户的配置
  if (process.env.PHOTO) {
    data.content.photo = { ...(data.content.photo || {}), path: process.env.PHOTO, caption: process.env.CAPTION || "" };
  }
  const results = [];

  for (const id of list) {
    try {
      const { html, dither: baseDither } = buildTemplate(
        id,
        data,
        process.env.DATE ? new Date(process.env.DATE + "T12:00:00") : new Date(),
        FAKE_WEATHER
      );
      // 允许用环境变量覆盖阈值，方便做阈值扫描
      const dither = { ...baseDither, ...(process.env.THRESH ? { threshold: Number(process.env.THRESH) } : {}) };
      const t0 = Date.now();
      const { png, frame, size } = await renderToFrame(html, {
        dither,
        onStep: (s) => say(`  [${id}] ${s}`),
      });
      const ms = Date.now() - t0;

      const tag = process.env.THRESH ? `-t${process.env.THRESH}` : "";
      fs.writeFileSync(path.join(OUT_DIR, `${id}${tag}.png`), png);
      fs.writeFileSync(path.join(OUT_DIR, `${id}${tag}.bin`), Buffer.from(frame));
      fs.writeFileSync(path.join(OUT_DIR, `${id}${tag}-quant.png`), frameToPreviewPng(frame, size.width, size.height));

      const counts = { black: 0, white: 0, red: 0, yellow: 0 };
      const names = ["black", "white", "yellow", "red"];
      for (const byte of frame) for (let s = 6; s >= 0; s -= 2) counts[names[(byte >> s) & 3]]++;
      const total = size.width * size.height;
      const pct = {};
      for (const k of Object.keys(counts)) pct[k] = +((counts[k] / total) * 100).toFixed(2);

      results.push({ id, size, ms, colors: pct });
      say(`✓ ${id}  ${size.width}×${size.height}  ${ms}ms  黑${pct.black}% 白${pct.white}% 红${pct.red}% 黄${pct.yellow}%`);
    } catch (e) {
      results.push({ id, error: e.message });
      say(`✗ ${id}  ${e.message}`);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, "render-test.json"), JSON.stringify(results, null, 2));
  say("全部完成");
  app.quit();
}).catch((e) => {
  say("失败：" + (e && e.stack ? e.stack : e));
  app.exit(1);
});

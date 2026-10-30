/**
 * 缺失元素自动检测：DOM 里有、量化图里没有 → 报告
 *
 * 原理：threshold 量化下文字核心笔画（亮度<100）必然保留；
 * 所以"DOM 有内容元素但量化图该区域全白"必为布局/渲染 bug，不是量化损失。
 *
 * 用法：electron tools/misscheck.js   （结果写 out/misscheck.log）
 */
const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-lcd-text");
app.disableHardwareAcceleration();
app.setPath("userData", path.join(process.env.APPDATA, "inkpad"));

const { renderHtml, dispose } = require("../app/render");
const { buildTemplate, TEMPLATES } = require("../app/templates");
const { to2bpp } = require("../app/dither");
const store = require("../app/store");

const OUT = [];
const say = (s) => OUT.push(s);

app.whenReady().then(async () => {
  try {
    const data = store.get();
    const weather = data.weather || null;

    for (const t of TEMPLATES) {
      let bgra, width, height, frame;
      try {
        const { html, dither } = buildTemplate(t.id, data, new Date(), weather);
        const r = await renderHtml(html, 400, 300);
        bgra = r.bgra; width = r.width; height = r.height;
        const rgba = new Uint8ClampedArray(bgra.length);
        for (let i = 0; i < bgra.length; i += 4) {
          rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = 255;
        }
        frame = to2bpp(rgba, width, height, dither);
      } catch (e) {
        say(t.id + ": 渲染失败 " + e.message);
        continue;
      }

      // DOM 探针：拿"有直接文本或可见背景/边框"的叶子元素
      const win = BrowserWindow.getAllWindows().find((w) => {
        const u = w.webContents.getURL();
        return u.startsWith("data:") || u.includes("inkpad-render-");
      });
      const els = await win.webContents.executeJavaScript(`(() => {
        const out = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) continue;
          if (r.right > 400 || r.bottom > 300 || r.left < 0 || r.top < 0) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) continue;
          const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          const hasBorder = cs.borderTopWidth !== "0px" || cs.borderLeftWidth !== "0px";
          const hasBg = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
          if (!hasOwnText && !hasBorder && !hasBg) continue;
          out.push({ tag: el.tagName, cls: el.className && el.className.baseVal !== undefined ? String(el.className.baseVal) : String(el.className || ""),
            x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
            text: (el.textContent || "").trim().slice(0, 18) });
        }
        return out;
      })()`).catch((e) => { say(t.id + ": 探针失败 " + e.message); return null; });
      if (!els) continue;

      // 原始图核心笔画检测 + 量化图非白检测
      const misses = [];
      for (const el of els) {
        const isWhite = (code) => code === 1;
        let quantNonWhite = 0, rawDark = 0, area = el.w * el.h;
        for (let y = el.y; y < el.y + el.h && y < 300; y++) {
          for (let x = el.x; x < el.x + el.w && x < 400; x++) {
            const i = y * 400 + x;
            const code = (frame[i >> 2] >> (6 - (i % 4) * 2)) & 3;
            if (!isWhite(code)) quantNonWhite++;
            const bi = i * 4;
            // bgra：B=bgra[i*4]，红在最前不对——直接查原始里的核心黑（任何通道低）
            const mn = Math.min(bgra[bi], bgra[bi + 1], bgra[bi + 2]);
            if (mn < 120) rawDark++;
          }
        }
        // DOM 有字/图形，原始渲染却无核心像素 → 没画出来
        // 原始有核心像素，量化却全白 → 量化丢失（理论上不该发生）
        const rawEmpty = rawDark < area * 0.005;
        const quantEmpty = quantNonWhite < area * 0.005;
        if (el.text && rawEmpty) misses.push({ ...el, kind: "DOM有字但原始渲染空白" });
        else if (!rawEmpty && quantEmpty) misses.push({ ...el, kind: "原始有但量化后消失", rawDark });
      }
      say("===== " + t.id + " (" + t.name + ") " + (misses.length ? "发现 " + misses.length + " 处" : "OK"));
      for (const m of misses) say("  [" + m.kind + "] " + m.tag + "." + m.cls + " @(" + m.x + "," + m.y + " " + m.w + "x" + m.h + ") 文本:" + JSON.stringify(m.text));
    }
  } catch (e) {
    say("出错: " + e.message);
  } finally {
    dispose();
    fs.mkdirSync(path.join(__dirname, "..", "out"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "..", "out", "misscheck.log"), OUT.join("\n"), "utf8");
    console.log("done");
    app.exit(0);
  }
});

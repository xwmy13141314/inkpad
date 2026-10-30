/**
 * 溢出自检：所有模板逐个渲染，报出
 *   1. 页面级溢出（scrollWidth/Height 超出 400×300）
 *   2. 元素越出视口边界（rect 超出 400×300 且有可见内容）
 *   3. 元素内容被自身裁切（scrollHeight > clientHeight，含故意 overflow:hidden 的，人工判断）
 *
 * 用法：electron tools/overflowcheck.js
 * 输出：out/overflowcheck.log
 */
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-lcd-text");
app.disableHardwareAcceleration();
app.setPath("userData", path.join(__dirname, "..", ".userdata"));

const { renderHtml, dispose } = require("../app/render");
const { buildTemplate, TEMPLATES } = require("../app/templates");
const store = require("../app/store");

const FAKE_WEATHER = {
  cache: { temp: 26, hi: 29, lo: 22, humidity: 70, cond: "多云", at: new Date().toISOString() },
  at: new Date().toISOString(),
};

const OUT = [];
const say = (m) => OUT.push(m);

const PROBE = `(() => {
  const VW = 400, VH = 300, out = [];
  const de = document.documentElement;
  if (de.scrollWidth > VW || de.scrollHeight > VH)
    out.push("页面溢出 scroll=" + de.scrollWidth + "x" + de.scrollHeight);
  for (const el of document.body.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const hasText = (el.childElementCount === 0 && el.textContent.trim());
    const hasBg = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.borderTopWidth !== "0px";
    // 越界：有文字或背景的元素超出画布 1px 以上
    if ((hasText || hasBg) && (r.right > VW + 1 || r.bottom > VH + 1 || r.left < -1 || r.top < -1))
      out.push("越界 <" + el.tagName.toLowerCase() + "." + (el.className || "") + "> rect=" +
        [r.left, r.top, r.right, r.bottom].map((v) => +v.toFixed(1)).join(","));
    // 被裁切：内容比盒子高 3px 以上（滚动条不占位）
    if (el.scrollHeight > el.clientHeight + 3 && el.clientHeight > 0)
      out.push("裁切 <" + el.tagName.toLowerCase() + "." + (el.className || "") + "> 内容" +
        el.scrollHeight + "px > 盒" + el.clientHeight + "px 文本=" +
        JSON.stringify(el.textContent.trim().slice(0, 20)));
  }
  return out.join("\\n");
})()`;

app.whenReady().then(async () => {
  let bad = 0;
  for (const t of TEMPLATES) {
    try {
      const data = store.get();
      const { html } = buildTemplate(t.id, data, new Date(), FAKE_WEATHER);
      await renderHtml(html, 400, 300);
      const { BrowserWindow } = require("electron");
      const win = BrowserWindow.getAllWindows().find((w) => {
        const u = w.webContents.getURL();
        return u.startsWith("data:") || u.includes("inkpad-render-");
      });
      const r = await win.webContents.executeJavaScript(PROBE);
      if (r) {
        bad++;
        say(`✗ ${t.id}（${t.name}）` + "\n" + r.split("\n").map((l) => "    " + l).join("\n"));
      } else {
        say(`✓ ${t.id}（${t.name}）`);
      }
    } catch (e) {
      bad++;
      say(`✗ ${t.id}（${t.name}）渲染失败: ${e.message}`);
    }
  }
  say(bad ? `\n${bad} 个模板有可疑项` : "\n全部干净");
  fs.mkdirSync(path.join(__dirname, "..", "out"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "..", "out", "overflowcheck.log"), OUT.join("\n"), "utf8");
  dispose();
  app.exit(0);
});

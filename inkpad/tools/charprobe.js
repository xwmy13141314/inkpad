/**
 * 逐字符探针：列出指定元素文本里每个字符的渲染 rect（含半宽/越界检测）
 * 用法：electron tools/charprobe.js <模板id> <选择器>
 * 环境变量 DATE=2026-06-05 可指定日期
 */
const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-lcd-text");
app.disableHardwareAcceleration();
app.setPath("userData", path.join(process.env.APPDATA, "inkpad"));

const { renderHtml, dispose } = require("../app/render");
const { buildTemplate } = require("../app/templates");
const store = require("../app/store");

const id = process.argv[2] || "history";
const sel = process.argv[3] || ".d";
const OUT = [];

app.whenReady().then(async () => {
  try {
    const data = store.get();
    const { html } = buildTemplate(
      id, data,
      process.env.DATE ? new Date(process.env.DATE + "T12:00:00") : new Date(),
      data.weather || null
    );
    await renderHtml(html, 400, 300);
    const win = BrowserWindow.getAllWindows().find((w) => {
      const u = w.webContents.getURL();
      return u.startsWith("data:") || u.includes("inkpad-render-");
    });
    const r = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return "无元素 " + ${JSON.stringify(sel)};
      const textNode = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!textNode) return "无直接文本节点";
      const range = document.createRange();
      const parentRect = el.getBoundingClientRect();
      const out = [];
      for (let i = 0; i < textNode.textContent.length; i++) {
        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);
        const rects = [...range.getClientRects()];
        out.push({
          ch: textNode.textContent[i],
          rects: rects.map((r) => ({ x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) })),
        });
      }
      return JSON.stringify({ parent: { x: parentRect.x, y: parentRect.y, w: parentRect.width, h: parentRect.height }, chars: out }, null, 0);
    })()`).catch((e) => "探针失败: " + e.message);
    OUT.push(String(r));
  } catch (e) {
    OUT.push("出错: " + e.message);
  } finally {
    dispose();
    fs.mkdirSync(path.join(__dirname, "..", "out"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "..", "out", "charprobe.log"), OUT.join("\n"), "utf8");
    console.log("done");
    app.exit(0);
  }
});

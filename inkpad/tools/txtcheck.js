/**
 * 小字量化对照：渲染指定模板，1:1 并排打印指定区域的 原始灰度 vs 量化
 * 用法：electron tools/txtcheck.js <模板id> <x> <y> <w> <h>
 * （stdout 接不到管道，结果写 out/txtcheck.log）
 */
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-lcd-text");
app.disableHardwareAcceleration();
app.setPath("userData", path.join(process.env.APPDATA, "inkpad"));

const { renderHtml, dispose } = require("../app/render");
const { buildTemplate } = require("../app/templates");
const { to2bpp } = require("../app/dither");
const store = require("../app/store");

const OUT = [];
const id = process.argv[2] || "daily-read";
const [X, Y, W, H] = [+(process.argv[3] || 0), +(process.argv[4] || 0), +(process.argv[5] || 400), +(process.argv[6] || 300)];

app.whenReady().then(async () => {
  try {
    const data = store.get();
    const weather = data.weather || null;
    const { html, dither } = buildTemplate(
      id,
      data,
      process.env.DATE ? new Date(process.env.DATE + "T12:00:00") : new Date(),
      weather
    );
    const { bgra, width, height } = await renderHtml(html, 400, 300);
    const rgba = new Uint8ClampedArray(bgra.length);
    for (let i = 0; i < bgra.length; i += 4) {
      rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = 255;
    }
    const frame = to2bpp(rgba, width, height, dither);
    const RAMP = ".:-=+*#%@";
    const th = (dither && dither.threshold) || 170;
    OUT.push(`模板 ${id} 区域(${X},${Y},${W},${H}) threshold=${th}  灰度RAMP: '.'=255白 → '@'=0黑；量化 '#'=黑 'R'=红 '.'=白`);
    for (let y = Y; y < Y + H; y++) {
      let l1 = "", l2 = "";
      for (let x = X; x < X + W; x++) {
        const i = y * width + x;
        const l = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
        l1 += RAMP[Math.min(8, Math.floor((255 - l) / 25.5))];
        const code = (frame[i >> 2] >> (6 - (i % 4) * 2)) & 3;
        l2 += code === 0 ? "#" : code === 1 ? "." : code === 3 ? "R" : "?";
      }
      OUT.push(String(y).padStart(3) + " 原|" + l1 + "  量|" + l2);
    }
  } catch (e) {
    OUT.push("出错: " + e.message);
  } finally {
    dispose();
    fs.mkdirSync(path.join(__dirname, "..", "out"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "..", "out", "txtcheck.log"), OUT.join("\n"), "utf8");
    console.log("done");
    app.exit(0);
  }
});

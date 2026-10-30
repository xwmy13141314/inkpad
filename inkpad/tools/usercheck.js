/**
 * 用用户真实数据渲染全部模板，输出量化缩略到 out/usercheck.log
 * （render-test 用沙盒空数据，看不出用户实际看到的缺失）
 */
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("disable-lcd-text");
app.disableHardwareAcceleration();
// 直接用应用真实 userData：读用户真实 data.json（store 只读不写已存在的文件）
app.setPath("userData", path.join(process.env.APPDATA, "inkpad"));

const { renderHtml, dispose } = require("../app/render");
const { buildTemplate, TEMPLATES } = require("../app/templates");
const store = require("../app/store");
const { to2bpp } = require("../app/dither");

const OUT = [];
const say = (s) => OUT.push(s);

app.whenReady().then(async () => {
  try {
    const data = store.get();
    // 用户 data.json 里的天气缓存（若有）
    const weather = data.weather || null;
    say("weather 缓存: " + (weather && weather.cache ? JSON.stringify(weather.cache).slice(0, 120) : "无（天气类模板用占位）"));
    const RAMP = " .:-=+*#%@";

    for (const t of TEMPLATES) {
      try {
        const { html, dither } = buildTemplate(t.id, data, new Date(), weather);
        const { bgra, width, height } = await renderHtml(html, 400, 300);
        // 直接从 bgra 重建量化帧 → 预览灰度（与上屏一致）
        const rgba = new Uint8ClampedArray(bgra.length);
        for (let i = 0; i < bgra.length; i += 4) {
          rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = 255;
        }
        const frame = to2bpp(rgba, width, height, dither);
        say("\n===== " + t.id + " (" + t.name + ") =====");
        const S = 8;
        for (let y = 0; y < height; y += S) {
          let line = "";
          for (let x = 0; x < width; x += S) {
            let dark = 0, total = 0;
            for (let dy = 0; dy < S && y + dy < height; dy++) {
              for (let dx = 0; dx < S && x + dx < width; dx++) {
                const i = y * width + x + dy * width + dx;
                const code = (frame[i >> 2] >> (6 - (i % 4) * 2)) & 3;
                if (code !== 1) dark++; // 非白 = 黑/黄/红
                total++;
              }
            }
            const ratio = dark / total;
            line += ratio === 0 ? "." : ratio < 0.25 ? "+" : ratio < 0.6 ? "*" : "#";
          }
          say(line);
        }
      } catch (e) {
        say(t.id + " 渲染失败: " + e.message);
      }
    }
  } catch (e) {
    say("出错: " + e.message);
  } finally {
    dispose();
    fs.mkdirSync(path.join(__dirname, "..", "out"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "..", "out", "usercheck.log"), OUT.join("\n"), "utf8");
    console.log("done");
    app.exit(0);
  }
});

#!/usr/bin/env node
/**
 * UI 截图目检：加载 ui/index.html，对主界面 / AI 卡表单 / 侧栏滚动 / 抽屉截 5 图写 out/。
 * 不依赖真机与真渲染：串口返回空、预览用 SVG 占位。渲染端 console 错误写 out/ui-shot.log。
 * 用法：./node_modules/.bin/electron tools/ui-shot.js
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "out");
const LOG = [];

// 独立 userData，别污染 render-test 的 .userdata
app.setPath("userData", path.join(ROOT, ".userdata-ui"));
app.commandLine.appendSwitch("force-device-scale-factor", "1");

const store = require(path.join(ROOT, "app", "store"));

// 预览占位（SVG data URL，img.src 直接可用）
const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'><rect width='400' height='300' fill='#ffffff' stroke='#e5e5ea'/><text x='200' y='155' text-anchor='middle' font-family='sans-serif' font-size='15' fill='#8e8e93'>400×300 预览占位</text></svg>`
  );

// 最小 IPC 桩：app.js 启动依赖这几个通道
ipcMain.handle("store:get", async () => store.get());
ipcMain.handle("store:update", async (_e, patch) => ({ ok: true, data: store.update(patch) }));
ipcMain.handle("ports:list", async () => []);
ipcMain.handle("render:template", async () => ({
  ok: true,
  preview: PLACEHOLDER,
  frame: null,
  size: { width: 400, height: 300 },
  ms: 1,
}));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1120,
    height: 860,
    show: true,
    webPreferences: {
      preload: path.join(ROOT, "app", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.on("console-message", (_e, _lvl, msg) => LOG.push(msg));

  await win.loadFile(path.join(ROOT, "ui", "index.html"));
  const shot = (name) =>
    win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(OUT, name + ".png"), img.toPNG()));
  const js = (code) => win.webContents.executeJavaScript(code + "; ''");

  await wait(1000); // 等 boot + 渲染
  await js("switchTemplate('date-card')"); // 显式定位到空模板，别受上次持久化 active 影响
  await wait(400);
  await shot("ui-1-main");

  await js("switchTemplate('ai-card')");
  await wait(500);
  await shot("ui-2-ai-card");

  await js("$('tplList').scrollTop = 1e5");
  await wait(250);
  await shot("ui-3-sidebar-scroll");

  await js("$('tplList').scrollTop = 0; $('debugPanel').classList.remove('hide')");
  await wait(300);
  await shot("ui-4-debug");

  await js("$('debugPanel').classList.add('hide'); $('wifiPanel').classList.remove('hide')");
  await wait(300);
  await shot("ui-5-wifi");
  await js("$('wifiPanel').classList.add('hide')");

  // 19 个模板遍历兜底：表单全渲染一遍，只查 console 错误
  const ids = await win.webContents.executeJavaScript("TEMPLATES.map(t => t.id)");
  for (const id of ids) {
    await js(`switchTemplate('${id}')`);
    await wait(120);
  }
  // 服务商联动冒烟：切智谱再切回阿里，看 baseUrl/model 跟着变
  await js("switchTemplate('ai-card')");
  await wait(300);
  const smoke = await win.webContents.executeJavaScript(`(() => {
    const get = (k) => document.querySelector('#formBody input[data-key="'+k+'"]').value;
    applyVendor('zhipu');
    const zhipu = { base: get('baseUrl'), model: get('model') };
    applyVendor('aliyun');
    const aliyun = { base: get('baseUrl'), model: get('model') };
    return JSON.stringify({ zhipu, aliyun });
  })()`);
  LOG.push("VENDOR_SMOKE " + smoke);

  fs.writeFileSync(path.join(OUT, "ui-shot.log"), LOG.join("\n") + "\n");
  app.quit();
});

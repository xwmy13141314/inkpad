/**
 * 墨签 InkPad —— Electron 主进程
 *
 * M1 阶段只做通路验证：
 *   列串口 → 连接 → 读 INFO → 刷测试图 / 推纯色
 * 渲染和模板在 M2/M3 接进来。
 */

const { app, BrowserWindow, ipcMain, Menu, dialog } = require("electron");
const path = require("path");
const { Device, crc32 } = require("./serial");
const wifi = require("./transport-wifi");
const { renderToFrame, frameToPreviewPng, dispose } = require("./render");
const { buildTemplate, TEMPLATES } = require("./templates");
const store = require("./store");
const { fetchWeather } = require("./weather");
const ai = require("./ai");

// 必须在本进程 ready 之前设置。
// 显示缩放不是 100% 时，离屏窗口会按缩放比渲染（例如 1.25 倍 → 500×375），
// 拿不到 400×300 的整幅像素。代价是高缩放屏上界面会显得小一点，换来渲染结果确定。
app.commandLine.appendSwitch("force-device-scale-factor", "1");
// 关掉次像素抗锯齿（LCD text）。Windows 下字边缘会产生 RGB 彩色条纹，
// 被三色量化当成"红"，黑字上会出现红边。
app.commandLine.appendSwitch("disable-lcd-text");

// Windows 上 Electron 的 stdout 接不到管道，排障只能靠文件日志
const fs = require("fs");
const LOGF = path.join(app.getPath("userData"), "app.log");
function flog(msg) {
  try {
    fs.appendFileSync(LOGF, `${new Date().toISOString()} ${msg}\n`);
  } catch (_) {}
}
flog("=== 启动 ===");

let win = null;
const device = new Device();

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

device.on("log", (text) => send("device:log", text));

function createWindow() {
  win = new BrowserWindow({
    // 强制了 device-scale-factor=1，高分屏上会显得偏小，这里放大补偿
    width: 1120,
    height: 860,
    minWidth: 900,
    minHeight: 700,
    title: "墨签 InkPad",
    backgroundColor: "#f5f5f7",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const pagePath = path.join(__dirname, "..", "ui", "index.html");
  flog("加载页面 " + pagePath);
  win.loadFile(pagePath).catch((e) => flog("loadFile 失败: " + e.message));
  win.webContents.on("did-finish-load", () => flog("页面加载完成"));
  win.webContents.on("did-fail-load", (_e, code, desc, url) => flog(`did-fail-load ${code} ${desc} ${url}`));
  win.webContents.on("render-process-gone", (_e, d) => flog("渲染进程退出: " + d.reason));
  win.webContents.on("console-message", (_e, level, msg, line, src) =>
    flog(`[renderer] ${msg}  (${src}:${line})`)
  );
  win.on("closed", () => {
    win = null;
    // 离屏渲染窗常驻复用（销毁重建会崩），它会拦住 window-all-closed；
    // 主窗一关就主动退出，由 before-quit → dispose() 收掉离屏窗
    app.quit();
  });
}

// ── IPC ────────────────────────────────────────────────────
ipcMain.handle("ports:list", async () => {
  try {
    const list = await Device.list();
    return list.map((p) => ({
      path: p.path,
      label: [p.friendlyName || p.manufacturer || "", p.vendorId, p.productId]
        .filter(Boolean)
        .join(" "),
    }));
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle("device:open", async (_e, portPath) => {
  try {
    await device.open(portPath);
    const info = await device.info().catch(() => null);
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("device:close", async () => {
  await device.close();
  return { ok: true };
});

ipcMain.handle("device:cmd", async (_e, cmd) => {
  try {
    const line = await device.command(cmd, { expect: /^(OK|ERR|PONG|INFO|DONE|SKIP)/, timeout: 8000 });
    return { ok: true, line };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("device:test", async () => {
  try {
    await device.testPattern();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("device:solid", async (_e, color) => {
  try {
    const r = await device.pushSolid(color);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("device:blank", async () => {
  try {
    await device.blank();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── 渲染 ───────────────────────────────────────────────────
ipcMain.handle("render:template", async (_e, id) => {
  try {
    const data = store.get();
    const { html, dither } = buildTemplate(id, data, new Date(), data.weather);
    const t0 = Date.now();
    const { frame, size } = await renderToFrame(html, { dither });
    return {
      ok: true,
      // 预览用量化帧上色：所见即所推，也避开 toPNG 截到光栅化中间帧的偶发缺字
      preview: "data:image/png;base64," + frameToPreviewPng(frame, size.width, size.height).toString("base64"),
      frame, // Uint8Array，IPC 可以直接传
      size,
      ms: Date.now() - t0,
    };
  } catch (e) {
    flog("渲染失败 " + id + ": " + (e && e.stack ? e.stack : e));
    return { ok: false, error: e.message };
  }
});

// ── 存储 ───────────────────────────────────────────────────
ipcMain.handle("store:get", async () => store.get());

ipcMain.handle("store:update", async (_e, patch) => {
  try {
    return { ok: true, data: store.update(patch) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── 天气 ───────────────────────────────────────────────────
ipcMain.handle("weather:refresh", async () => {
  const data = store.get();
  const loc = data.content.weather || {};
  try {
    const cache = await fetchWeather({ city: loc.city || "深圳", lat: loc.lat, lon: loc.lon });
    store.update({ weather: { cache, at: cache.at } });
    return { ok: true, cache };
  } catch (e) {
    // 抓不到不算失败：保留旧缓存，模板会标「离线」
    const old = data.weather && data.weather.cache;
    return { ok: false, error: e.message, cache: old || null };
  }
});

// ── AI 卡片 ────────────────────────────────────────────────
ipcMain.handle("ai:generate", async (_e, presetId, force) => {
  const cfg = (store.get().content || {})["ai-card"] || {};
  try {
    const r = await ai.generateCard(
      { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model },
      presetId,
      { force }
    );
    return { ok: true, card: r.card, from: r.from };
  } catch (e) {
    return { ok: false, error: e.message, noKey: !!e.noKey };
  }
});

// ── 选图片 ─────────────────────────────────────────────────
ipcMain.handle("photo:pick", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "选择照片",
    properties: ["openFile"],
    filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  return { ok: true, path: r.filePaths[0] };
});

// ── 串口：多行命令（SCAN / AP / CFG 用）──────────────────
ipcMain.handle("device:rawcmd", async (_e, cmd, expect, timeout) => {
  try {
    const r = await device.commandCollect(cmd, {
      expect: new RegExp(expect || "^(OK|ERR)"),
      timeout: timeout || 15000,
    });
    return { ok: true, line: r.line, lines: r.lines };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── WiFi 副通路 ───────────────────────────────────────────
ipcMain.handle("wifi:discover", async () => {
  try {
    const found = await wifi.discover();
    return { ok: true, found };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("wifi:info", async (_e, ip) => {
  try {
    return { ok: true, info: await wifi.info(ip) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("wifi:ping", async (_e, ip) => {
  try {
    return { ok: true, alive: await wifi.ping(ip) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("wifi:push", async (_e, ip, bytes) => {
  try {
    const buf = Buffer.from(bytes);
    const crc = crc32(buf);
    await wifi.pushFrame(ip, buf, crc);
    return { ok: true, crc };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("device:pushbytes", async (_e, bytes) => {
  try {
    const r = await device.pushFrame(Buffer.from(bytes));
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── 生命周期 ───────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
flog("单例锁 gotLock=" + gotLock);
if (!gotLock) {
  // 已有实例持锁。ready 前调 quit() 偶发被初始化流程吞掉导致本进程也挂住；
  // 此路径未开任何资源，直接 exit 立即退出最稳
  app.exit(0);
} else {
  app.on("second-instance", () => {
    if (!win) {
      // 窗口已关但进程未退（异常残留）：重建窗口，避免双击无反应
      createWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  flog("注册 whenReady");
  app.whenReady().then(() => {
    flog("app ready");
    Menu.setApplicationMenu(null);
    createWindow();
  });

  app.on("window-all-closed", async () => {
    // device.close() 可能因串口异常挂起，限时兜底防止进程退不出变僵尸占锁
    await Promise.race([
      device.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    app.quit();
  });

  app.on("before-quit", () => {
    device.close().catch(() => {});
    dispose();
  });
}

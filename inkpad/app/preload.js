const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("inkpad", {
  // 设备
  listPorts: () => ipcRenderer.invoke("ports:list"),
  open: (portPath) => ipcRenderer.invoke("device:open", portPath),
  close: () => ipcRenderer.invoke("device:close"),
  cmd: (cmd) => ipcRenderer.invoke("device:cmd", cmd),
  test: () => ipcRenderer.invoke("device:test"),
  solid: (color) => ipcRenderer.invoke("device:solid", color),
  blank: () => ipcRenderer.invoke("device:blank"),
  pushBytes: (bytes) => ipcRenderer.invoke("device:pushbytes", bytes),
  rawCmd: (cmd, expect, timeout) => ipcRenderer.invoke("device:rawcmd", cmd, expect, timeout),

  // WiFi 副通路
  wifiDiscover: () => ipcRenderer.invoke("wifi:discover"),
  wifiInfo: (ip) => ipcRenderer.invoke("wifi:info", ip),
  wifiPing: (ip) => ipcRenderer.invoke("wifi:ping", ip),
  wifiPush: (ip, bytes) => ipcRenderer.invoke("wifi:push", ip, bytes),

  // 渲染与内容
  render: (id) => ipcRenderer.invoke("render:template", id),
  storeGet: () => ipcRenderer.invoke("store:get"),
  storeUpdate: (patch) => ipcRenderer.invoke("store:update", patch),
  weatherRefresh: () => ipcRenderer.invoke("weather:refresh"),
  aiGenerate: (presetId, force) => ipcRenderer.invoke("ai:generate", presetId, force),
  pickPhoto: () => ipcRenderer.invoke("photo:pick"),

  onLog: (fn) => ipcRenderer.on("device:log", (_e, text) => fn(text)),
});

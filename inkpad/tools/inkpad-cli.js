#!/usr/bin/env node
/**
 * 墨签 InkPad 命令行工具
 *
 * 不依赖 Electron，直接说串口协议。用于开发验证和故障排查。
 *
 *   node tools/inkpad-cli.js ports
 *   node tools/inkpad-cli.js info   [COMx]
 *   node tools/inkpad-cli.js ping   [COMx]
 *   node tools/inkpad-cli.js test   [COMx]
 *   node tools/inkpad-cli.js solid  [COMx] white|black|red
 *   node tools/inkpad-cli.js cal    [COMx] 0-3
 *   node tools/inkpad-cli.js frame  [COMx] file.bin   原始 2bpp 30000 字节
 *
 * 省略 COMx 时自动找乐鑫设备（VID 303A）。
 */

const fs = require("fs");
const path = require("path");
const { Device } = require("../app/serial");

const ESPRESSIF_VID = "303a";

async function pickPort(explicit) {
  const list = await Device.list();
  if (!list.length) {
    throw new Error("没有发现任何串口，检查 USB 是否插好");
  }
  if (explicit) {
    const hit = list.find((p) => p.path.toLowerCase() === explicit.toLowerCase());
    if (!hit) throw new Error(`找不到串口 ${explicit}，现有：${list.map((p) => p.path).join(", ")}`);
    return hit.path;
  }
  const esp = list.filter((p) => (p.vendorId || "").toLowerCase() === ESPRESSIF_VID);
  if (esp.length === 1) return esp[0].path;
  if (esp.length > 1) throw new Error(`发现多个乐鑫设备：${esp.map((p) => p.path).join(", ")}，请指定`);
  throw new Error(`没找到乐鑫设备（VID 303A）。现有串口：${list.map((p) => p.path).join(", ")}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^\/\*\*?/, ""));
    return;
  }

  if (cmd === "ports") {
    const list = await Device.list();
    if (!list.length) return console.log("（无）");
    for (const p of list) {
      const isEsp = (p.vendorId || "").toLowerCase() === ESPRESSIF_VID;
      console.log(
        `${p.path.padEnd(8)} ${isEsp ? "[乐鑫]" : "      "} ${p.friendlyName || ""} ` +
          `${p.vendorId ? `VID_${p.vendorId} PID_${p.productId}` : ""}`
      );
    }
    return;
  }

  // 参数里凡形如 COMx 的当端口，其余当命令参数
  let portArg = null;
  let arg = null;
  for (const a of argv.slice(1)) {
    if (/^com\d+$/i.test(a)) portArg = a;
    else arg = a;
  }

  const port = await pickPort(portArg);

  const dev = new Device();
  dev.on("log", (t) => console.log("  " + t));
  await dev.open(port);
  console.log(`已连接 ${port}\n`);

  try {
    switch (cmd) {
      case "ping":
        await dev.command("PING", { expect: /^PONG/ });
        break;

      case "info":
        console.log(await dev.info());
        break;

      case "test":
        await dev.testPattern();
        break;

      case "solid": {
        const color = arg || "white";
        const r = await dev.pushSolid(color);
        console.log(`结果：${r.result}  crc=${r.crc}`);
        break;
      }

      case "cal":
        await dev.command("CAL " + (arg || "2"), { expect: /^(OK|ERR)/ });
        break;

      case "frame": {
        if (!arg) throw new Error("需要指定 .bin 文件");
        const buf = fs.readFileSync(path.resolve(arg));
        const r = await dev.pushFrame(buf);
        console.log(`结果：${r.result}  crc=${r.crc}`);
        break;
      }

      default:
        throw new Error(`未知命令：${cmd}`);
    }
  } finally {
    await dev.close();
  }
}

main().catch((e) => {
  console.error("\n失败：" + e.message);
  process.exit(1);
});

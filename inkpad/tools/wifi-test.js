#!/usr/bin/env node
/**
 * WiFi 传输层测试：用模拟设备把 app/transport-wifi.js 完整验一遍
 *
 *   node tools/wifi-test.js
 *
 * 真机接不上 WiFi 的时候，靠这个保证应用侧逻辑是对的。
 * 模拟设备严格复刻 firmware_usb/src/net.cpp 的接口行为。
 */

const { startMock, FRAME_LEN } = require("./mock-device");
const { ping, pushFrame, info } = require("../app/transport-wifi");
const { crc32, solidFrame } = require("../app/serial");

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

(async () => {
  const PORT = 18080;
  const { server, state } = await startMock(PORT);

  console.log("\n[1] 探活与信息");
  const alive = await ping("127.0.0.1", PORT);
  check("GET /ping 返回 200", alive);

  const dev = await info("127.0.0.1", PORT);
  check("GET /info 拿到 ip/ssid", !!dev.ip && !!dev.ssid, JSON.stringify(dev));

  console.log("\n[2] 推一帧");
  const frame = solidFrame("red");
  const crc = crc32(frame);
  await pushFrame("127.0.0.1", frame, crc, PORT);
  check("设备收到 1 帧", state.frames.length === 1, `实际 ${state.frames.length}`);
  check("帧长度 30000", state.frames[0] && state.frames[0].len === FRAME_LEN);
  check("crc 一致", state.frames[0] && state.frames[0].crc === crc, `${state.frames[0].crc} vs ${crc}`);
  check("触发了一次刷屏", state.shows.length === 1, `show crc=${state.shows[0]}`);
  check("帧内容与发出的一致", state.lastFrame && state.lastFrame.equals(frame));

  console.log("\n[3] 错误路径");
  // 长度不对
  let threw = false;
  try {
    await pushFrame("127.0.0.1", Buffer.alloc(100), crc32(Buffer.alloc(100)), PORT);
  } catch (e) {
    threw = /拒收帧/.test(e.message);
  }
  check("长度不对时抛错", threw);

  // crc 不对
  threw = false;
  try {
    await pushFrame("127.0.0.1", frame, 12345, PORT);
  } catch (e) {
    threw = /拒收帧/.test(e.message);
  }
  check("crc 不对时抛错", threw);

  // 设备返回 500
  state.failFrame = true;
  threw = false;
  try {
    await pushFrame("127.0.0.1", frame, crc, PORT);
  } catch (e) {
    threw = /拒收帧/.test(e.message);
  }
  check("设备报错时抛错", threw);
  state.failFrame = false;

  // 连不上
  threw = false;
  try {
    await ping("127.0.0.1", 1, 1500);
  } catch (e) {
    threw = true;
  }
  check("连不上时抛错", threw);

  console.log("\n[4] 请求序列");
  const expect = ["GET /ping", "GET /info", "POST /frame", "POST /show"];
  const ok = expect.every((e) => state.requests.includes(e));
  check("请求路径与固件一致", ok, state.requests.join(" | "));

  server.close();
  console.log(failed ? `\n失败 ${failed} 项\n` : "\n全部通过\n");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("测试异常：", e);
  process.exit(1);
});

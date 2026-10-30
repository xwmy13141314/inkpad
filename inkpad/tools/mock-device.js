/**
 * 模拟设备：在电脑上复刻固件的 HTTP 接口
 *
 *   GET  /info            → {"ip":"...","ssid":"..."}
 *   GET  /ping            → {"pong":1}
 *   POST /frame?crc=<crc> → body 30000 字节 2bpp
 *   POST /show?crc=<crc>  → 触发刷屏
 *
 * 用途：在真机接不上 WiFi 的情况下，把应用侧的传输层完整验一遍。
 * 接口和 firmware_usb/src/net.cpp 一一对应，改那边记得同步这里。
 */

const http = require("http");
const { crc32 } = require("../app/serial");

const FRAME_LEN = 30000;

function startMock(port = 8080, opts = {}) {
  const state = {
    port,
    frames: [],      // 收到的每一帧
    shows: [],       // 每次 /show 的 crc
    lastFrame: null,
    requests: [],
    // 模拟异常：设了之后 /frame 返回 400
    failFrame: false,
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    state.requests.push(`${req.method} ${url.pathname}`);

    const json = (code, obj) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    if (req.method === "GET" && url.pathname === "/info") {
      return json(200, { ip: "127.0.0.1", ssid: opts.ssid || "mock-net" });
    }
    if (req.method === "GET" && url.pathname === "/ping") {
      return json(200, { pong: 1 });
    }

    if (req.method === "POST" && url.pathname === "/frame") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        if (state.failFrame) return json(400, { error: "mock failure" });
        if (body.length !== FRAME_LEN) {
          return json(400, { error: `bad length ${body.length}` });
        }
        const crc = Number(url.searchParams.get("crc") || 0);
        const real = crc32(body);
        if (crc && crc !== real) {
          return json(400, { error: `crc mismatch ${real} != ${crc}` });
        }
        state.lastFrame = body;
        state.frames.push({ len: body.length, crc: real });
        return json(200, { ok: 1 });
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/show") {
      const crc = Number(url.searchParams.get("crc") || 0);
      state.shows.push(crc);
      return json(200, { ok: 1 });
    }

    return json(404, { error: "not found" });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ server, state, port }));
  });
}

module.exports = { startMock, FRAME_LEN };

// 直接运行就起一个模拟设备，方便手工用 curl 试
if (require.main === module) {
  const port = Number(process.argv[2] || 8080);
  startMock(port).then(({ state }) => {
    console.log(`模拟设备已启动 http://127.0.0.1:${port}`);
    console.log("接口：GET /info  GET /ping  POST /frame?crc=  POST /show?crc=");
    setInterval(() => {
      if (state.frames.length) {
        console.log(`收到帧 ${state.frames.length} 次，最近 crc=${state.frames[state.frames.length - 1].crc}`);
      }
    }, 5000);
  });
}

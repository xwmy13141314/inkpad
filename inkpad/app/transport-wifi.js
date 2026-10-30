/**
 * WiFi 副通路的传输层
 *
 * 设备在 WiFi 模式下跑一个极简 HTTP 服务：
 *   GET  /info            → {"ip":"...","ssid":"..."}
 *   GET  /ping            → {"pong":1}
 *   POST /frame?crc=<crc> → body 是 30000 字节 2bpp，返回 {"ok":1}
 *   POST /show?crc=<crc>  → 触发刷屏
 *
 * 发现设备有两条路：
 *   1. mDNS：设备广播 inkpad.local，电脑按名字解析
 *   2. UDP 广播探测：设备监听 45353，回应广播 → 直接拿到 IP
 *   3. 都不行就手动填 IP（软 AP 模式下固定是 192.168.4.1）
 *
 * 帧格式和串口完全一样（30000B 2bpp + CRC32），所以两条通路的代码是共用的。
 */

const http = require("http");
const dgram = require("dgram");
const dns = require("dns").promises;

const MDNS_NAME = "inkpad.local";
const DISCOVER_PORT = 45353;
const PROBE = "INKPAD?";

// ── HTTP ────────────────────────────────────────────────────
function httpReq(host, port, method, path, body, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port, method, path, timeout: timeoutMs, headers: body ? { "Content-Length": body.length } : {} },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, body: buf, text: buf.toString("utf8") });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** 探活 */
async function ping(host, port = 80, timeoutMs = 3000) {
  const r = await httpReq(host, port, "GET", "/ping", null, timeoutMs);
  return r.status === 200;
}

/** 推一帧并刷屏 */
async function pushFrame(host, frame, crc, port = 80) {
  const r1 = await httpReq(host, port, "POST", `/frame?crc=${crc}`, frame, 20000);
  if (r1.status !== 200) throw new Error(`设备拒收帧：HTTP ${r1.status} ${r1.text.slice(0, 80)}`);

  const r2 = await httpReq(host, port, "POST", `/show?crc=${crc}`, null, 20000);
  if (r2.status !== 200) throw new Error(`设备拒收刷新：HTTP ${r2.status}`);
  return true;
}

async function info(host, port = 80) {
  const r = await httpReq(host, port, "GET", "/info", null, 3000);
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  try {
    return JSON.parse(r.text);
  } catch (_) {
    throw new Error("返回内容不是 JSON");
  }
}

// ── 发现 ────────────────────────────────────────────────────
/** mDNS 解析 inkpad.local */
async function discoverByMdns(timeoutMs = 2500) {
  try {
    const addrs = await withTimeout(dns.resolve4(MDNS_NAME), timeoutMs);
    if (addrs && addrs.length) return addrs[0];
  } catch (_) {}
  return null;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

/** UDP 广播探测：设备会回应自己的 IP */
function discoverByBroadcast(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    let done = false;
    const finish = (ip) => {
      if (done) return;
      done = true;
      try {
        sock.close();
      } catch (_) {}
      resolve(ip);
    };
    sock.on("error", () => finish(null));
    sock.on("message", (msg) => {
      const s = msg.toString("utf8").trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) finish(s);
    });
    sock.bind(() => {
      try {
        sock.setBroadcast(true);
        sock.send(PROBE, DISCOVER_PORT, "255.255.255.255");
      } catch (_) {}
    });
    setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * 依次尝试三种发现方式
 * @returns {Promise<{ip:string, via:string}|null>}
 */
async function discover() {
  const byMdns = await discoverByMdns();
  if (byMdns) return { ip: byMdns, via: "mDNS" };

  const byUdp = await discoverByBroadcast();
  if (byUdp) return { ip: byUdp, via: "UDP 广播" };

  return null;
}

module.exports = {
  ping,
  pushFrame,
  info,
  discover,
  discoverByMdns,
  discoverByBroadcast,
  MDNS_NAME,
  DISCOVER_PORT,
  PROBE,
};

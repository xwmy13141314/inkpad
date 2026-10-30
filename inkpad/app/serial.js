/**
 * 串口协议封装
 *
 * 协议见 firmware_usb/src/main.cpp 顶部注释：
 *   ASCII 命令行 + 二进制帧，全部以 \n 结尾
 *   FRAME <len> <crc32>  →  READY  →  裸数据  →  OK / ERR
 *   SHOW  [crc32]        →  SKIP 或 SHOWING… DONE <ms>
 *
 * 注意：SHOW 会阻塞 13 秒左右（三色屏全刷的物理耗时），超时要给足。
 */

const { SerialPort } = require("serialport");
const { EventEmitter } = require("events");

const W = 400;
const H = 300;
const COLOR_LEN = (W * H) / 4; // 30000

// ── CRC32（与 zlib / 固件实现一致）──────────────────────────
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 生成纯色 2bpp 缓冲
 * 调色板：0=黑 1=白 2=黄 3=红，每字节 4 像素，高位在前
 */
function solidFrame(color) {
  const code = { black: 0, white: 1, yellow: 2, red: 3 }[color];
  if (code === undefined) throw new Error("未知颜色: " + color);
  const byte = (code << 6) | (code << 4) | (code << 2) | code;
  return Buffer.alloc(COLOR_LEN, byte);
}

class Device extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.rx = Buffer.alloc(0);
    this.waiters = [];
    this.collected = [];            // 本次命令期间收到的所有行
    this.queue = Promise.resolve(); // 串行化所有请求，避免命令交叉
  }

  static list() {
    return SerialPort.list();
  }

  get isOpen() {
    return !!(this.port && this.port.isOpen);
  }

  async open(path) {
    if (this.port) await this.close();
    // dtr/rts 必须显式置 false：ESP32-C3 的原生 USB CDC 用这两个信号做复位，
    // 打开时默认拉高会把芯片带进下载模式，表现为"连上了但命令没反应"。
    const port = new SerialPort({ path, baudRate: 115200, autoOpen: false, dtr: false, rts: false });
    await new Promise((resolve, reject) => {
      port.open((err) => (err ? reject(err) : resolve()));
    });
    this.port = port;
    this.rx = Buffer.alloc(0);
    port.on("data", (d) => this._onData(d));
    port.on("error", (e) => this._emitLog("串口错误：" + e.message));
    port.on("close", () => this._emitLog("串口已关闭"));
    this._emitLog(`已打开 ${path}`);
    return true;
  }

  async close() {
    const p = this.port;
    this.port = null;
    this._failAll("串口已关闭");
    if (!p) return;
    await new Promise((resolve) => {
      if (!p.isOpen) return resolve();
      p.close(() => resolve());
    });
  }

  // ── 底层收发 ────────────────────────────────────────────
  _emitLog(text) {
    this.emit("log", String(text));
  }

  _onData(chunk) {
    // 用 Buffer 累积再按 0x0A 切行，避免 UTF-8 多字节字符被 chunk 边界切断后乱码
    this.rx = Buffer.concat([this.rx, chunk]);
    let idx;
    while ((idx = this.rx.indexOf(0x0a)) >= 0) {
      const line = this.rx.subarray(0, idx).toString("utf8").replace(/\r$/, "");
      this.rx = this.rx.subarray(idx + 1);
      if (!line) continue;
      this.collected.push(line);
      this._emitLog("← " + line);
      this._dispatch(line);
    }
  }

  _dispatch(line) {
    // ESP-IDF 的部分日志不带换行，会和设备的回复粘成一行（例如
    // "[402][E][esp32-hal-spi.c:227] ...PONG 1.0.0"）。这里额外从第一个
    // 协议关键字处切开再匹配一次，避免一行垃圾日志就让整条请求超时。
    const variants = [line];
    const m = line.match(/\b(PONG|INFO|READY|ACK|OK|ERR|DONE|SKIP|SHOWING|BOOT)\b/);
    if (m && m.index > 0) variants.push(line.slice(m.index));

    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i];
      if (variants.some((v) => w.re.test(v))) {
        this.waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(line);
        return;
      }
    }
  }

  _failAll(reason) {
    const list = this.waiters.splice(0);
    for (const w of list) {
      clearTimeout(w.timer);
      w.reject(new Error(reason));
    }
  }

  _waitFor(re, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      const w = { re, resolve, reject };
      w.timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`${label} 超时（${timeoutMs}ms 未收到回复）`));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  _write(data) {
    return new Promise((resolve, reject) => {
      if (!this.isOpen) return reject(new Error("串口未打开"));
      this.port.write(data, (err) => (err ? reject(err) : resolve()));
    });
  }

  /**
   * 整帧写入：按 1KB 分块，每块等设备回 ACK 再发下一块。
   *
   * 为什么不能一口气写：Windows 的 USB CDC 在 30000 字节突发下会丢数据，
   * 主机 write 回调正常返回、设备却只收到 17~22KB，且没有任何报错。
   * 分块确认是唯一稳的办法（30 个来回，几十毫秒）。
   */
  async _writeFrame(buf) {
    const CHUNK = 1024;
    for (let off = 0; off < buf.length; off += CHUNK) {
      const n = Math.min(CHUNK, buf.length - off);
      const expect = off + n;
      const ack = this._waitFor(new RegExp(`^ACK ${expect}$`), 5000, `分块 ACK ${expect}`);
      await this._write(buf.subarray(off, off + n));
      await ack;
    }
  }

  // 所有对外请求排队执行
  _enqueue(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  // ── 对外接口 ────────────────────────────────────────────
  command(cmd, { expect = /^(OK|ERR|PONG|INFO)/, timeout = 5000 } = {}) {
    return this._enqueue(async () => {
      this._emitLog("→ " + cmd);
      const waiter = this._waitFor(expect, timeout, cmd.split(" ")[0]);
      await this._write(cmd + "\n");
      return waiter;
    });
  }

  /**
   * 发一条命令，等到 expect 匹配为止，把期间收到的所有行都返回。
   * 用来接 SCAN 这种会先吐一堆行、最后才给结论的命令。
   */
  commandCollect(cmd, { expect, timeout = 15000 } = {}) {
    return this._enqueue(async () => {
      this._emitLog("→ " + cmd);
      this.collected = [];
      const waiter = this._waitFor(expect, timeout, cmd.split(" ")[0]);
      await this._write(cmd + "\n");
      const line = await waiter;
      return { line, lines: this.collected.slice() };
    });
  }

  async info() {
    const line = await this.command("INFO", { expect: /^INFO / });
    const kv = {};
    for (const part of line.slice(5).trim().split(/\s+/)) {
      const [k, v] = part.split("=");
      if (k) kv[k] = v;
    }
    return kv;
  }

  /** 推一帧并刷屏。返回 {crc, result} */
  pushFrame(buf) {
    return this._enqueue(async () => {
      if (buf.length !== COLOR_LEN) {
        throw new Error(`帧长度错误：${buf.length}，应为 ${COLOR_LEN}`);
      }
      const crc = crc32(buf);

      this._emitLog(`→ FRAME ${buf.length} ${crc}`);
      const ready = this._waitFor(/^READY/, 5000, "FRAME");
      await this._write(`FRAME ${buf.length} ${crc}\n`);
      await ready;

      // 二进制数据：不分行，直接写（分块 + drain，见 _writeFrame）
      const ack = this._waitFor(/^(OK|ERR)/, 30000, "数据校验");
      await this._writeFrame(buf);
      const ackLine = await ack;
      if (ackLine.startsWith("ERR")) throw new Error("设备拒收：" + ackLine);

      this._emitLog(`→ SHOW ${crc}`);
      const done = this._waitFor(/^(DONE|SKIP)/, 60000, "SHOW");
      await this._write(`SHOW ${crc}\n`);
      const doneLine = await done;

      return { crc, result: doneLine };
    });
  }

  pushSolid(color) {
    return this.pushFrame(solidFrame(color));
  }

  async testPattern() {
    await this.command("TEST", { expect: /^DONE/, timeout: 60000 });
    return true;
  }

  async setCal(v) {
    return this.command(`CAL ${v}`, { expect: /^(OK|ERR)/ });
  }

  async blank() {
    await this.command("BLANK", { expect: /^DONE/, timeout: 60000 });
    return true;
  }
}

module.exports = { Device, crc32, solidFrame, COLOR_LEN, W, H };

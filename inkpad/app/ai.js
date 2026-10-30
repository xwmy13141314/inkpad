/**
 * AI 卡片引擎：OpenAI 兼容客户端 + 当日缓存
 *
 * 兼容智谱 GLM / DeepSeek / 阿里百炼 / OpenAI / 任何 OpenAI 风格 chat/completions 服务。
 * 生成结果按「预设 + 日期」缓存到 userData/ai-cache.json，
 * 墨水屏一天刷一次，同一天重复渲染不重复扣费；断网也能用当天缓存。
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { app } = require("electron");

const PRESETS = require("./ai-presets");

// ── 缓存 ───────────────────────────────────────────────────
let cachePath = null;
function cacheFile() {
  if (!cachePath) cachePath = path.join(app.getPath("userData"), "ai-cache.json");
  return cachePath;
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
  } catch (_) {
    return {};
  }
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
  fs.writeFileSync(cacheFile(), JSON.stringify(cache, null, 2), "utf8");
}

/** 取某预设今天的缓存；没有返回 null */
function todayCache(presetId, date = new Date()) {
  const key = `${presetId}:${date.toISOString().slice(0, 10)}`;
  return loadCache()[key] || null;
}

// ── 生成 ───────────────────────────────────────────────────
/** 调一次 chat/completions，返回文本 */
function chat({ baseUrl, apiKey, model, messages, timeoutMs = 45000 }) {
  const url = new URL(baseUrl.replace(/\/+$/, "") + "/chat/completions");
  const body = JSON.stringify({ model, messages, temperature: 0.8, max_tokens: 500 });
  const lib = url.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "http:" ? 80 : 443),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            let msg = `HTTP ${res.statusCode}`;
            try {
              msg += " " + (JSON.parse(data).error?.message || data.slice(0, 120));
            } catch (_) {}
            return reject(new Error(msg));
          }
          try {
            resolve(JSON.parse(data).choices[0].message.content);
          } catch (e) {
            reject(new Error("响应格式异常：" + data.slice(0, 120)));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
    req.end(body);
  });
}

/** 模型输出的 JSON 可能裹在 ```json 围栏里，剥掉再解析 */
function parseJson(text) {
  const stripped = String(text).replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const m = stripped.match(/[\[{][\s\S]*[\]}]/);
  return JSON.parse(m ? m[0] : stripped);
}

/**
 * 生成一张卡片。有当天缓存直接用；没有才调 API。
 * 返回 { ok, card, from } —— from: "cache" | "api"
 */
async function generateCard(cfg, presetId, { date = new Date(), force = false } = {}) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error("未知预设：" + presetId);

  if (!force) {
    const hit = todayCache(presetId, date);
    if (hit) return { ok: true, card: hit, from: "cache" };
  }

  if (!cfg.apiKey) {
    const err = new Error("还没填 API Key（在 AI 卡片表单里配置）");
    err.noKey = true;
    throw err;
  }

  const raw = await chat({
    baseUrl: cfg.baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: cfg.apiKey,
    model: cfg.model || "qwen3.8-flash",
    messages: [
      { role: "system", content: preset.system },
      { role: "user", content: preset.user(date) },
    ],
  });

  const obj = parseJson(raw);
  const card = {
    title: String(obj.title || "").slice(0, 40),
    body: String(obj.body || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 12),
    foot: String(obj.foot || "").slice(0, 30),
  };
  if (!card.title || !card.body.length) throw new Error("模型没按约定返回内容");

  const cache = loadCache();
  const keys = Object.keys(cache);
  // 只留最近 80 张，缓存文件不无限长
  if (keys.length > 80) {
    for (const k of keys.sort().slice(0, keys.length - 80)) delete cache[k];
  }
  cache[`${presetId}:${date.toISOString().slice(0, 10)}`] = card;
  saveCache(cache);
  return { ok: true, card, from: "api" };
}

module.exports = { PRESETS, generateCard, todayCache };

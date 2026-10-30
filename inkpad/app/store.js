/**
 * 内容存储：一个 data.json，人可读、可备份、可手改
 *
 * 位置：<userData>/data.json
 *   Windows  %APPDATA%\inkpad\data.json
 *   macOS    ~/Library/Application Support/inkpad/data.json
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const DEFAULT_QUOTES = [
  "保持热爱，奔赴山海",
  "慢慢来，比较快",
  "把时间花在值得的事上",
  "不必成为别人，只需做自己",
  "所谓自由，是能拒绝不想做的事",
  "与其焦虑，不如动手",
  "每天进步一点点，一年就是三十七倍",
  "允许一切发生",
  "把复杂的事做简单，把简单的事做扎实",
  "所有的答案都在路上",
  "走得慢没关系，别停",
  "热爱可抵岁月漫长",
  "少即是多",
  "想清楚再动手，比动手后再想清楚划算",
  "真正的自律是让自己不费力",
  "今天也要好好吃饭",
  "与其证明自己，不如做成一件事",
  "长期主义者不着急",
  "保持好奇，保持笨拙",
  "把今天过好，就是最好的计划",
  "选择比努力重要，但选择也是一种能力",
  "不要用战术上的勤奋掩盖战略上的懒惰",
  "能做成的事，都是先做起来的事",
  "愿你有好运气，如果没有，愿你在不幸中学会慈悲",
];

const DEFAULTS = {
  version: 1,
  active: "date-card",
  device: { port: "", cal: 2 },
  content: {
    quote: { text: "", source: "", pinned: true, index: 0 },
    memo: {
      title: "本周",
      body: "1. 把渲染管线跑通\n2. 调日期牌版面\n3. 试试相框抖动",
    },
    dashboard: {
      todos: [
        { text: "写方案", done: false },
        { text: "跑步 10km", done: false },
        { text: "买菜", done: true },
      ],
    },
    weather: { city: "深圳", lat: 22.5431, lon: 114.0579 },
    countdown: { items: [{ name: "出发", date: "2026-12-01" }] },
    photo: { path: "", caption: "", contrast: 55 },
    almanac: {},
    calendar: {},
    "daily-read": { season: "", battery: 100, footLeft: "每日", footRight: "" },
    todo: {
      title: "待办",
      items: [
        { text: "写方案", done: false, urgent: false },
        { text: "跑步 10km", done: false, urgent: false },
        { text: "买菜", done: true, urgent: false },
      ],
    },
    poetry: { source: "古诗文", pinned: false, index: 0 },
    word: { tag: "每日一词", left: "CET-4", example: "" },
    habit: {
      title: "习惯",
      habits: [
        { name: "跑步", days: [1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 1] },
        { name: "阅读", days: [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1] },
        { name: "早睡", days: [0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0] },
      ],
    },
    "ai-card": {
      preset: "question",
      title: "",
      body: "",
      foot: "",
      provider: "aliyun",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen3.8-flash",
      apiKey: "",
    },
    moyu: { offwork: "18:00", extra: "" },
    lifebar: { title: "", birthday: "", lifespan: 80, foot: "" },
    "year-progress": {
      title: "",
      sub: "",
      marks: [
        { date: "2026-06-01", name: "半年" },
        { date: "2026-10-01", name: "国庆" },
      ],
    },
    history: {},
  },
  quotes: DEFAULT_QUOTES,
  weather: { cache: null, at: null },
};

let cache = null;
let filePath = null;

function resolvePath() {
  if (filePath) return filePath;
  filePath = path.join(app.getPath("userData"), "data.json");
  return filePath;
}

function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch;
  if (typeof base !== "object" || base === null) return patch;
  if (typeof patch !== "object" || patch === null) return patch;
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    out[k] = k in base ? deepMerge(base[k], patch[k]) : patch[k];
  }
  return out;
}

function load() {
  if (cache) return cache;
  const p = resolvePath();
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      cache = deepMerge(DEFAULTS, raw);
      return cache;
    }
  } catch (e) {
    // 文件损坏时不要清空用户内容，先备份再重建
    try {
      fs.copyFileSync(p, p + ".broken");
    } catch (_) {}
  }
  cache = JSON.parse(JSON.stringify(DEFAULTS));
  save();
  return cache;
}

function save() {
  const p = resolvePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cache, null, 2), "utf8");
}

function get() {
  return load();
}

/** 局部更新，返回更新后的完整数据 */
function update(patch) {
  cache = deepMerge(load(), patch);
  save();
  return cache;
}

function setActive(template) {
  cache = load();
  cache.active = template;
  save();
  return cache;
}

module.exports = { get, update, setActive, save, resolvePath, DEFAULTS, DEFAULT_QUOTES };

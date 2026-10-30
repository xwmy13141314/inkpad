/**
 * 模板装载与数据组装
 *
 * 模板是纯 HTML/CSS，占位符写成 {{key}}，用 renderTemplate() 填充。
 * 加一种风格 = 加一个 html + 一个 data 函数，不用碰渲染管线。
 */

const fs = require("fs");
const path = require("path");
const { Solar } = require("lunar-javascript");

const TEMPLATE_DIR = path.join(__dirname, "..", "ui", "templates");

function renderTemplate(name, data) {
  const file = path.join(TEMPLATE_DIR, `${name}.html`);
  const tpl = fs.readFileSync(file, "utf8");
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = data[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

// 工具函数放在 util.js，templates-extra.js 也要用
const { esc, isoWeek, yearProgress, daysBetween, dayIndex } = require("./util");
const EXTRA = require("./templates-extra");

// ── 各模板的数据 ───────────────────────────────────────────

/** 日期牌 */
function dateCardData(date = new Date()) {
  const solar = Solar.fromDate(date);
  const lunar = solar.getLunar();
  const wd = solar.getWeekInChinese();
  const isWeekend = wd === "六" || wd === "日";
  const jieqi = lunar.getJieQi() || "";
  const festivals = [...(solar.getFestivals() || []), ...(lunar.getFestivals() || [])];
  const festival = festivals[0] || "";

  return {
    day: String(date.getDate()),
    year: String(date.getFullYear()),
    month: `${date.getMonth() + 1}月`,
    weekday: `星期${wd}`,
    weekdayClass: isWeekend ? "weekend" : "",
    lunar: `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    ganzhi: `${lunar.getYearInGanZhi()}年 · ${lunar.getDayInGanZhi()}日`,
    jieqi: jieqi || festival,
    footer: jieqi || festival || "保持热爱，奔赴山海",
    week: `第 ${isoWeek(date)} 周`,
  };
}

/** 金句：字数决定字号，太长的自动缩小 */
function quoteData(store, date = new Date()) {
  const c = (store.content && store.content.quote) || {};
  const pool = (store.quotes || []).filter(Boolean);
  let text = (c.text || "").trim();
  let index = 0;

  if (!text && pool.length) {
    // 没手填就按日轮换（固定模式下用 index）
    const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
    index = c.pinned ? Number(c.index || 0) % pool.length : day % pool.length;
    text = pool[index];
  }
  if (!text) text = "保持热爱，奔赴山海";

  const len = [...text].length;
  const fontSize = len <= 10 ? 36 : len <= 16 ? 32 : len <= 24 ? 27 : len <= 40 ? 22 : 18;

  return {
    text: esc(text),
    source: c.source ? `—— ${esc(c.source)}` : "",
    fontSize,
    date: `${date.getFullYear()} · ${date.getMonth() + 1} · ${date.getDate()}`,
    index: pool.length ? `${(index % pool.length) + 1} / ${pool.length}` : "",
  };
}

/** 信息看板 */
function dashboardData(store, date = new Date(), weather = null) {
  const solar = Solar.fromDate(date);
  const lunar = solar.getLunar();
  const wd = solar.getWeekInChinese();
  const isWeekend = wd === "六" || wd === "日";

  const todos = ((store.content && store.content.dashboard && store.content.dashboard.todos) || [])
    .filter((t) => t && String(t.text || "").trim())
    .slice(0, 5);

  const todosHtml = todos
    .map(
      (t) =>
        `<div class="todo${t.done ? " done" : ""}"><div class="box"></div><div class="txt">${esc(t.text)}</div></div>`
    )
    .join("");

  const w = weather && weather.cache ? weather.cache : null;

  return {
    day: String(date.getDate()),
    weekday: `星期${wd}`,
    weekdayClass: isWeekend ? "weekend" : "",
    lunar: `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    temp: w ? w.temp : "--",
    cond: w ? w.cond : "无数据",
    range: w ? `最高 ${w.hi}° / 最低 ${w.lo}°` : "",
    todos: todosHtml || `<div class="todo"><div class="box"></div><div class="txt">（没有待办）</div></div>`,
    progress: yearProgress(date),
    progressLabel: `${date.getFullYear()} 年已过`,
  };
}

/** 备忘录 */
function memoData(store, date = new Date()) {
  const c = (store.content && store.content.memo) || {};
  const body = String(c.body || "");
  const lines = body.split("\n").length;
  const fontSize = lines <= 5 ? 17 : lines <= 8 ? 15 : 13;

  return {
    title: esc(c.title || "备忘"),
    body: esc(body),
    fontSize,
    date: `${date.getMonth() + 1}月${date.getDate()}日`,
  };
}

/** 天气卡 */
function weatherData(store, weather = null) {
  const loc = (store.content && store.content.weather) || {};
  const w = weather && weather.cache ? weather.cache : null;

  let updated = "还没有数据";
  let stale = "";
  let staleClass = "";
  if (w && w.at) {
    const at = new Date(w.at);
    const hh = String(at.getHours()).padStart(2, "0");
    const mm = String(at.getMinutes()).padStart(2, "0");
    updated = `数据 ${hh}:${mm}`;
    const ageMin = (Date.now() - at.getTime()) / 60000;
    if (ageMin > 60) {
      stale = "离线";
      staleClass = "stale";
    }
  }

  return {
    city: esc(loc.city || "深圳"),
    temp: w ? w.temp : "--",
    cond: w ? esc(w.cond) : "无数据",
    hi: w ? w.hi : "--",
    lo: w ? w.lo : "--",
    humidity: w ? w.humidity : "--",
    feels: w && Number.isFinite(w.feels) ? w.feels : "--",
    windText: w && w.windText ? w.windText : "--",
    updated,
    stale,
    staleClass,
  };
}

/** 倒数日：取最近的一个未来事件 */
function countdownData(store, date = new Date()) {
  const items = ((store.content && store.content.countdown && store.content.countdown.items) || []).filter(
    (it) => it && it.name && it.date
  );

  const parsed = items
    .map((it) => ({ name: it.name, date: it.date, d: daysBetween(date, new Date(it.date + "T00:00:00")) }))
    .sort((a, b) => (a.d < 0 ? Infinity : a.d) - (b.d < 0 ? Infinity : b.d) || a.d - b.d);

  const main = parsed[0];
  const others = parsed.slice(1, 3).map((x) => `${esc(x.name)} ${x.d}天`).join("   ");

  return {
    name: main ? esc(main.name) : "还没有事件",
    days: main ? Math.abs(main.d) : "--",
    date: main ? (main.d >= 0 ? `还有 ${main.d} 天 · ${main.date}` : `已过 ${-main.d} 天 · ${main.date}`) : "",
    others,
  };
}

/** 相框：把图片转成 data URL 内联，避免 file:// 跨域 */
function photoData(store) {
  const c = (store.content && store.content.photo) || {};
  const p = c.path;

  if (!p || !fs.existsSync(p)) {
    return { content: `<div class="empty">未选择照片</div>` };
  }

  const ext = path.extname(p).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";

  let dataUrl;
  try {
    dataUrl = `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
  } catch (e) {
    return { content: `<div class="empty">图片读取失败</div>` };
  }

  const caption = String(c.caption || "").trim();
  const bar = caption ? `<div class="bar"><span>${esc(caption)}</span><span></span></div>` : "";

  return { content: `<img class="photo" src="${dataUrl}">${bar}` };
}

// ── 模板清单（界面用）──────────────────────────────────────
const TEMPLATES = [
  { id: "date-card", name: "日期牌" },
  { id: "quote", name: "金句" },
  { id: "dashboard", name: "信息看板" },
  { id: "memo", name: "备忘录" },
  { id: "photo", name: "相框" },
  { id: "weather", name: "天气" },
  { id: "countdown", name: "倒数日" },
  { id: "almanac", name: "老黄历" },
  { id: "calendar", name: "日历" },
  { id: "daily-read", name: "日读" },
  { id: "todo", name: "待办" },
  { id: "poetry", name: "诗词" },
  { id: "word", name: "每日一词" },
  { id: "habit", name: "习惯" },
  { id: "ai-card", name: "AI 卡片" },
  { id: "moyu", name: "摸鱼日历" },
  { id: "lifebar", name: "人生进度" },
  { id: "year-progress", name: "年进度" },
  { id: "history", name: "今日历史" },
];

/** 统一入口：给模板名 + 存储数据，返回 {html, dither} */
function buildTemplate(id, store, date = new Date(), weather = null) {
  switch (id) {
    case "date-card":
      return { html: renderTemplate(id, dateCardData(date)), dither: { mode: "threshold", threshold: 170 } };
    case "quote":
      return { html: renderTemplate(id, quoteData(store, date)), dither: { mode: "threshold", threshold: 170 } };
    case "dashboard":
      return {
        html: renderTemplate(id, dashboardData(store, date, weather)),
        dither: { mode: "threshold", threshold: 170 },
      };
    case "memo":
      return { html: renderTemplate(id, memoData(store, date)), dither: { mode: "threshold", threshold: 170 } };
    case "weather":
      return { html: renderTemplate(id, weatherData(store, weather)), dither: { mode: "threshold", threshold: 170 } };
    case "countdown":
      return { html: renderTemplate(id, countdownData(store, date)), dither: { mode: "threshold", threshold: 170 } };
    case "photo": {
      const strength = Number((store.content?.photo?.dither ?? 60) / 100);
      return { html: renderTemplate(id, photoData(store)), dither: { mode: "fs", strength, threshold: 170 } };
    }
    case "almanac":
      return { html: renderTemplate(id, EXTRA.almanacData(store, date)), dither: { mode: "threshold", threshold: 170 } };
    case "calendar":
      return { html: renderTemplate(id, EXTRA.calendarData(store, date)), dither: { mode: "threshold", threshold: 170 } };
    case "daily-read":
      return {
        html: renderTemplate(id, EXTRA.dailyReadData(store, date, weather)),
        dither: { mode: "threshold", threshold: 170 },
      };
    case "todo":
      return { html: renderTemplate(id, EXTRA.todoData(store)), dither: { mode: "threshold", threshold: 170 } };
    case "poetry":
      return { html: renderTemplate(id, EXTRA.poetryData(store, date)), dither: { mode: "threshold", threshold: 170 } };
    case "word":
      return { html: renderTemplate(id, EXTRA.wordData(store, date)), dither: { mode: "threshold", threshold: 170 } };
    case "habit":
      return { html: renderTemplate(id, EXTRA.habitData(store)), dither: { mode: "threshold", threshold: 170 } };
    case "ai-card":
      return { html: renderTemplate(id, EXTRA.aiCardData(store, date)), dither: { mode: "threshold", threshold: 170 } };
    case "moyu":
      return { html: renderTemplate(id, EXTRA.moyuData(store, date)), dither: { mode: "threshold", threshold: 170 } };
    case "lifebar":
      return { html: renderTemplate(id, EXTRA.lifebarData(store, date)), dither: { mode: "threshold", threshold: 170 } };
    case "year-progress":
      return {
        html: renderTemplate(id, EXTRA.yearProgressData(store, date)),
        dither: { mode: "threshold", threshold: 170 },
      };
    case "history":
      return { html: renderTemplate(id, EXTRA.historyData(store, date)), dither: { mode: "threshold", threshold: 170 } };
    default:
      throw new Error("未知模板：" + id);
  }
}

module.exports = {
  renderTemplate,
  buildTemplate,
  TEMPLATES,
  dateCardData,
  quoteData,
  dashboardData,
  memoData,
  weatherData,
  countdownData,
  photoData,
  isoWeek,
  yearProgress,
  daysBetween,
  dayIndex,
  EXTRA,
  TEMPLATE_DIR,
};

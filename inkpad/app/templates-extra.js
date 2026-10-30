/**
 * 新增模板的数据组装（与 templates.js 分开，避免那个文件过长）
 *
 * 每个函数返回一组 {{key}} 占位符对应的值，交给 renderTemplate() 填进 html。
 */

const { Solar, Lunar } = require("lunar-javascript");
const { esc, yearProgress, dayIndex, isoWeek } = require("./util");
const AI = require("./ai");
const POEMS = require("./data/poems");
const HISTORY = require("./data/history");
const READING = require("./data/reading");
const WORDS = require("./data/words");

// ── 天气图标：内联 SVG，不依赖字体里有没有那个符号 ─────────
function weatherIcon(code) {
  const sun =
    `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.2">` +
    `<circle cx="8" cy="8" r="3.2" fill="#000" stroke="none"/>` +
    `<path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4" stroke-linecap="round"/></svg>`;
  const cloud =
    `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.2">` +
    `<path d="M4.5 12h7a2.5 2.5 0 0 0 .3-5A4 4 0 0 0 4.4 8 2 2 0 0 0 4.5 12z" fill="#fff"/></svg>`;
  const rain =
    `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.2">` +
    `<path d="M4.5 9.5h7a2.5 2.5 0 0 0 .3-5A4 4 0 0 0 4.4 5.5 2 2 0 0 0 4.5 9.5z" fill="#fff"/>` +
    `<path d="M5.5 11.5l-1 2.5M8.5 11.5l-1 2.5M11.5 11.5l-1 2.5" stroke-linecap="round"/></svg>`;
  if (code === 0) return sun;
  if (code >= 51) return rain;
  return cloud;
}

/** 日历里显示的公历节日白名单——过滤掉"世界住房日"之类的杂项国际日 */
const SOLAR_FESTS = [
  "元旦", "情人节", "妇女节", "植树节", "愚人节", "劳动节", "青年节",
  "母亲节", "儿童节", "父亲节", "建党节", "建军节", "教师节", "国庆节",
  "万圣夜", "万圣节", "感恩节", "平安夜", "圣诞节",
];

/** 日历：传统中国风月历（黑条表头 + 农历小字 + 红圆今日），参照用户样图 */
function calendarData(store, date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const startPad = new Date(y, m, 1).getDay(); // 0 = 周日，周日起始
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayKey = y + "-" + m + "-" + date.getDate();

  const head = ["日", "一", "二", "三", "四", "五", "六"];
  const headCells = head
    .map((h, i) => `<div class="h${i === 0 || i === 6 ? " we" : ""}">${h}</div>`)
    .join("");

  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(`<div class="cell blank"></div>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(y, m, d);
    const solar = Solar.fromDate(dt);
    const lunar = solar.getLunar();
    const wd = dt.getDay();
    const isToday = y + "-" + m + "-" + d === todayKey;

    // 小字优先级：节日 > 节气 > 农历日（初一显示月名）；节日/节气/月初红字
    const fest =
      (solar.getFestivals() || []).find((f) => SOLAR_FESTS.includes(f)) ||
      (lunar.getFestivals() || [])[0] ||
      "";
    const jieqi = lunar.getJieQi() || "";
    const chuYi = lunar.getDayInChinese() === "初一";
    const sub = fest || jieqi || (chuYi ? lunar.getMonthInChinese() + "月" : lunar.getDayInChinese());
    const subRed = fest || jieqi || chuYi;

    const cls = ["cell", wd === 0 || wd === 6 ? "we" : "", isToday ? "today" : ""].filter(Boolean).join(" ");
    cells.push(
      `<div class="${cls}"><div class="d">${d}</div><div class="s${subRed ? " red" : ""}">${esc(sub)}</div></div>`
    );
  }

  const lunar = Solar.fromDate(date).getLunar();
  return {
    title: `${y}年${m + 1}月`,
    meta1: `${lunar.getYearInGanZhi()}年 【${lunar.getYearShengXiao()}】`,
    meta2: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()} 【${isoWeek(date)}周】`,
    headCells,
    cells: cells.join(""),
  };
}

/** 粗略的季节词 */
function seasonWord(date) {
  const m = date.getMonth() + 1;
  if (m <= 2) return "冬藏，万物收藏。";
  if (m <= 5) return "春生，草木萌发。";
  if (m <= 8) return "夏长，草木繁茂。";
  return "秋收，果实成熟。";
}

/** 日读：左日期 + 右书摘 + 顶栏天气/电量 + 底栏题记 */
function dailyReadData(store, date = new Date(), weather = null) {
  const item = READING[dayIndex(date) % READING.length];
  const c = (store.content && store.content["daily-read"]) || {};
  const w = weather && weather.cache ? weather.cache : null;

  const hours = date.getHours();
  const ampm =
    hours < 6 ? "凌晨" : hours < 12 ? "上午" : hours < 13 ? "中午" : hours < 18 ? "下午" : "夜间";
  const wd = Solar.fromDate(date).getWeekInChinese();

  const battery = c.battery === undefined || c.battery === null ? 100 : Number(c.battery);
  const batteryHtml =
    `<span class="batt${battery <= 20 ? " low" : ""}">` +
    `<span class="shell"><span class="fill" style="width:${Math.max(4, battery)}%"></span></span>` +
    `<span>${battery}%</span></span>`;

  const weatherHtml = w
    ? `<span class="temp">${weatherIcon(w.code)}<span>${w.temp}°C</span></span>`
    : "";

  return {
    ampm,
    md: `${date.getMonth() + 1}月${date.getDate()}日`,
    weekday: `周${wd}`,
    weather: weatherHtml,
    battery: batteryHtml,
    year: String(date.getFullYear()),
    day: String(date.getDate()),
    month: `${date.getMonth() + 1}月`,
    weekdayShort: `周${wd}`,
    weekdayClass: wd === "六" || wd === "日" ? "weekend" : "",
    progress: yearProgress(date),
    season: c.season || seasonWord(date),
    quote: esc(item.q),
    from: `—— ${esc(item.from)}`,
    bookTitle: esc(item.b),
    bookAuthor: esc(item.ba),
    bookNote: esc(item.bn),
    footLeft: c.footLeft || "每日",
    footRight: esc(c.footRight || item.f),
  };
}

/** 待办清单 */
function todoData(store) {
  const c = (store.content && store.content.todo) || {};
  const items = (c.items || []).filter((i) => i && String(i.text || "").trim());
  const html = items
    .slice(0, 8)
    .map(
      (i) =>
        `<div class="item${i.done ? " done" : ""}${i.urgent ? " urgent" : ""}">` +
        `<div class="box"></div><div class="tx">${esc(i.text)}</div></div>`
    )
    .join("");
  const done = items.filter((i) => i.done).length;
  const percent = items.length ? Math.round((done / items.length) * 100) : 0;
  return {
    title: esc(c.title || "待办"),
    meta: `${items.length} 项`,
    items: html || `<div class="item"><div class="box"></div><div class="tx">（没有待办）</div></div>`,
    doneText: `已完成 ${done}/${items.length}`,
    percent,
  };
}

/** 诗词 */
function poetryData(store, date = new Date()) {
  const c = (store.content && store.content.poetry) || {};
  const p =
    c.pinned && c.index !== undefined ? POEMS[Number(c.index) % POEMS.length] : POEMS[dayIndex(date) % POEMS.length];
  // 行数多时缩字号压进行高：正文区可用高度约 165px
  const [fs, lh, sp] =
    p.l.length <= 4 ? [22, 1.85, 3]
    : p.l.length === 5 ? [20, 1.62, 2]
    : p.l.length === 6 ? [17, 1.58, 2]
    : p.l.length === 7 ? [15, 1.52, 1]
    : [13, 1.55, 1];
  // 长标题缩号防贴边（可用宽约 348px）
  const tLen = [...p.t].length;
  const [ts, tsp] = tLen <= 6 ? [22, 4] : tLen <= 9 ? [19, 3] : [16, 2];
  return {
    title: esc(p.t),
    author: `${p.d} · ${p.a}`,
    lines: p.l.map((l) => `<span class="ln">${esc(l)}</span>`).join(""),
    fontSize: fs,
    lineHeight: lh,
    spacing: sp,
    titleSize: ts,
    titleSpacing: tsp,
    source: esc(c.source || "古诗文"),
    seal: esc(p.a[0] || "诗"),
  };
}

/** 每日一词 */
function wordData(store, date = new Date()) {
  const c = (store.content && store.content.word) || {};
  const w = WORDS.pickByDate(date) || { word: "—", phonetic: "", meaning: "词库加载失败" };
  return {
    tag: c.tag || "每日一词",
    index: `共 ${WORDS.count()} 词`,
    word: esc(w.word),
    phonetic: esc(w.phonetic),
    meaning: esc(w.meaning),
    example: esc(c.example || ""),
    left: esc(c.left || "CET-4"),
    right: `${date.getMonth() + 1}月${date.getDate()}日`,
  };
}

/** 习惯打卡 */
function habitData(store) {
  const c = (store.content && store.content.habit) || {};
  const habits = (c.habits || []).filter((h) => h && h.name);
  const rows = habits
    .slice(0, 4)
    .map((h) => {
      const days = h.days || [];
      const cells = days
        .slice(-15)
        .map((v) => `<div class="c${v === 2 ? " half" : v ? " on" : ""}"></div>`)
        .join("");
      const on = days.filter((v) => v === 1 || v === 2).length;
      const rate = days.length ? Math.round((on / days.length) * 100) : 0;
      return (
        `<div class="row"><div class="name">${esc(h.name)}</div>` +
        `<div class="cells">${cells}</div><div class="rate">${rate}%</div></div>`
      );
    })
    .join("");
  const all = habits.flatMap((h) => h.days || []);
  const on = all.filter((v) => v === 1 || v === 2).length;
  return {
    title: esc(c.title || "习惯"),
    meta: "近 15 天",
    rows: rows || `<div class="row"><div class="name">（还没有习惯）</div></div>`,
    left: `总计 ${on} 次`,
    right: all.length ? `${Math.round((on / all.length) * 100)}%` : "0%",
  };
}

/** 年度进度 */
function yearProgressData(store, date = new Date()) {
  const c = (store.content && store.content["year-progress"]) || {};
  const pct = yearProgress(date);
  const marks = (c.marks || [])
    .map((m) => {
      const p = m.date
        ? Math.min(100, Math.max(0, yearProgress(new Date(m.date + "T00:00:00"))))
        : 0;
      return (
        `<div class="mark"><div class="d">${esc(m.date || "")}</div>` +
        `<div class="n">${esc(m.name || "")}</div><div class="p">${p}%</div></div>`
      );
    })
    .join("");
  const passed = Math.floor((date - new Date(date.getFullYear(), 0, 1)) / 86400000);
  return {
    title: esc(c.title || `${date.getFullYear()} 年进度`),
    percent: String(pct),
    sub: esc(c.sub || `已过 ${passed} 天，还剩 ${365 - passed} 天`),
    marks: marks || `<div class="mark"><div class="d"></div><div class="n">（在表单里加几个节点）</div><div class="p"></div></div>`,
    left: String(date.getFullYear()),
    right: "一年",
  };
}

/** 老黄历：农历 + 干支 + 宜忌（lunar-javascript 全本地） */
function almanacData(store, date = new Date()) {
  const solar = Solar.fromDate(date);
  const lunar = solar.getLunar();
  const wd = solar.getWeekInChinese();
  const pick = (arr) => (arr || []).filter((w) => w && [...w].length <= 4).slice(0, 5);
  const yi = pick(lunar.getDayYi());
  const ji = pick(lunar.getDayJi());
  const jieqi = lunar.getJieQi() || "";
  const fest = (solar.getFestivals() || [])[0] || (lunar.getFestivals() || [])[0] || "";

  return {
    lunarMonth: `${lunar.getMonthInChinese()}月`,
    lunarDay: lunar.getDayInChinese(),
    solarDate: `${date.getMonth() + 1}月${date.getDate()}日`,
    weekday: `星期${wd}`,
    weekendClass: wd === "六" || wd === "日" ? "weekend" : "",
    ganzhi: `${lunar.getMonthInGanZhi()}月${lunar.getDayInGanZhi()}日`,
    yi: yi.length ? yi.map((w) => `<span>${esc(w)}</span>`).join("") : `<span>诸事</span>`,
    ji: ji.length ? ji.map((w) => `<span>${esc(w)}</span>`).join("") : `<span>无忌</span>`,
    zodiac: `${lunar.getYearInGanZhi()}${lunar.getYearShengXiao()}年`,
    jieqi: jieqi || fest || "顺其自然，诸事皆宜",
  };
}

/** 人生进度条：生日 + 预期寿命 → 已过百分比/天数 */
function lifebarData(store, date = new Date()) {
  const c = (store.content && store.content.lifebar) || {};
  const title = esc(c.title || "人生进度");
  const foot = esc(c.foot || "今天也要好好生活");
  const lifespan = Math.min(150, Math.max(1, Number(c.lifespan) || 80));
  const birth = c.birthday ? new Date(String(c.birthday).trim() + "T00:00:00") : null;

  const head = `<div class="head"><div class="title">${title}</div><div class="day-no">{{DAYNO}}</div></div>`;
  if (!birth || isNaN(birth) || birth > date) {
    return {
      content:
        head.replace("{{DAYNO}}", "等待设置生日") +
        `<div class="empty">在表单里填生日，如 1995-06-15</div>` +
        `<div class="foot"><div>假设活到 ${lifespan} 岁</div><div>${foot}</div></div>`,
    };
  }

  const end = new Date(birth.getFullYear() + lifespan, birth.getMonth(), birth.getDate());
  const DAY = 86400000;
  const total = Math.round((end - birth) / DAY);
  const lived = Math.floor((date - birth) / DAY);
  const left = Math.max(0, total - lived);
  const pct = Math.min(100, Math.max(0, (lived / total) * 100));

  return {
    content:
      head.replace("{{DAYNO}}", `人生第 ${lived + 1} 天`) +
      `<div class="mid">` +
      `<div class="pct-row"><span class="pct">${pct.toFixed(1)}</span><span class="pct-unit">%</span></div>` +
      `<div class="bar"><div class="fill" style="width:${pct.toFixed(1)}%"></div></div>` +
      `<div class="years"><span>${birth.getFullYear()}</span><span class="now">${date.getFullYear()}</span><span>${end.getFullYear()}</span></div>` +
      `<div class="nums"><div>走过 <b>${lived}</b> 天 · 还剩 <b>${left}</b> 天</div>` +
      `<div class="sub">剩余 ≈ ${(left / 365.25).toFixed(1)} 年</div></div>` +
      `</div>` +
      `<div class="foot"><div>假设活到 ${lifespan} 岁</div><div>${foot}</div></div>`,
  };
}

/** 摸鱼日历：法定节假日全靠算法（农历节日反查 + 清明节气），不硬编码年份表 */
function moyuData(store, date = new Date()) {
  const c = (store.content && store.content.moyu) || {};
  const DAY = 86400000;
  const today0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const pad = (n) => String(n).padStart(2, "0");

  const y = date.getFullYear();
  const list = [];
  for (const yy of [y, y + 1]) {
    list.push({ name: "元旦", d: `${yy}-01-01` });
    list.push({ name: "劳动节", d: `${yy}-05-01` });
    list.push({ name: "国庆节", d: `${yy}-10-01` });
    try {
      for (const [m, dd, nm] of [[1, 1, "春节"], [5, 5, "端午节"], [8, 15, "中秋节"]]) {
        const s = Lunar.fromYmd(yy, m, dd).getSolar();
        list.push({ name: nm, d: `${s.getYear()}-${s.getMonth()}-${s.getDay()}` });
      }
      const qm = Lunar.fromDate(new Date(yy, 6, 1)).getJieQiTable()["清明"];
      if (qm && qm.getYear() === yy) list.push({ name: "清明节", d: `${qm.getYear()}-${qm.getMonth()}-${qm.getDay()}` });
    } catch (e) { /* 农历边界异常就跳过，剩下的照样能用 */ }
  }
  for (const line of String(c.extra || "").split("\n")) {
    const [d, name] = line.split("|").map((s) => (s || "").trim());
    if (d && name) list.push({ name, d });
  }

  const future = list
    .map((f) => ({ ...f, days: Math.round((new Date(f.d + "T00:00:00") - today0) / DAY) }))
    .filter((f) => f.days >= 0 && f.days < 400)
    .sort((a, b) => a.days - b.days);
  const main = future[0] || { name: "下一个节日", days: "--", d: "" };
  const second = future[1] || { name: "—", days: "" };

  // 距周末
  const wd = date.getDay();
  const weekend = wd === 0 || wd === 6 ? "就是今天" : `${6 - wd} 天`;

  // 距下班（渲染那一刻的状态，墨水屏一天一刷刚好）
  const [oh, om] = String(c.offwork || "18:00").split(":").map(Number);
  const offAt = new Date(today0.getTime() + (oh || 18) * 3600000 + (om || 0) * 60000);
  let offwork = "已下班";
  if (date < offAt) {
    const h = (offAt - date) / 3600000;
    offwork = h >= 1 ? `约 ${h.toFixed(1)} 小时` : `约 ${Math.max(1, Math.round(h * 60))} 分钟`;
  }

  const mDays = new Date(y, date.getMonth() + 1, 0).getDate();

  return {
    date: `${date.getMonth() + 1}月${date.getDate()}日`,
    weekday: `星期${Solar.fromDate(date).getWeekInChinese()}`,
    mainName: esc(main.name),
    mainDays: main.days === 0 ? "今天" : String(main.days),
    mainDate: main.days === 0 ? `今天就是${main.name}` : main.d.split("-").map(Number).join("-"),
    secondName: esc(second.name),
    secondDays: second.days === 0 ? "今天" : second.days,
    weekend,
    offwork,
    monthPct: Math.min(100, Math.round((date.getDate() / mDays) * 100)),
    yearPct: yearProgress(date),
  };
}

/** AI 卡片：手填内容优先，其次今日 AI 缓存，都没有就占位 */
function aiCardData(store, date = new Date()) {
  const c = (store.content && store.content["ai-card"]) || {};
  const preset = AI.PRESETS.find((p) => p.id === c.preset) || AI.PRESETS[0];

  let title = String(c.title || "").trim();
  let body = String(c.body || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  let foot = String(c.foot || "").trim();
  let from = "手动";

  if (!title || !body.length) {
    const card = AI.todayCache(preset.id, date);
    if (card) {
      if (!title) title = card.title;
      if (!body.length) body = card.body;
      if (!foot) foot = card.foot;
      from = "AI";
    }
  }

  const tag = preset.name;
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;

  if (!title || !body.length) {
    return {
      tag,
      date: md,
      content: `<div class="empty">还没有内容：在表单点「立即生成」</div>`,
    };
  }

  // 标题按长度缩号，正文按行数缩号（可用宽约 352px）
  const tLen = [...title].length;
  const tStyle = tLen <= 8 ? "font-size:26px" : tLen <= 12 ? "font-size:21px" : "font-size:17px";
  const bSize = body.length <= 4 ? 16 : body.length <= 6 ? 15 : 14;

  return {
    tag,
    date: md,
    content:
      `<div class="title" style="${tStyle}">${esc(title)}</div>` +
      `<div class="body" style="font-size:${bSize}px">` +
      body.map((l) => `<span class="ln">${esc(l.slice(0, 24))}</span>`).join("") +
      `</div>` +
      `<div class="foot"><div class="ai">${from === "AI" ? "墨签 · AI 生成" : "墨签"}</div><div>${esc(foot || preset.name)}</div></div>`,
  };
}

/** 今日历史 */
function historyData(store, date = new Date()) {
  const key =
    String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  const all = Object.entries(HISTORY);
  const hit = HISTORY[key];
  const item = hit ? [key, hit] : all[dayIndex(new Date(date.getFullYear(), 0, 1)) % all.length];
  return {
    md: item[0].replace("-", "月") + "日",
    title: esc(item[1].t),
    desc: esc(item[1].d),
    left: hit ? "历史上的今天" : "往日的这一天",
    right: `${date.getFullYear()}年`,
  };
}

module.exports = {
  weatherIcon,
  almanacData,
  moyuData,
  lifebarData,
  aiCardData,
  calendarData,
  dailyReadData,
  todoData,
  poetryData,
  wordData,
  habitData,
  yearProgressData,
  historyData,
  seasonWord,
};

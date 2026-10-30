const $ = (id) => document.getElementById(id);

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

// AI 服务商预设：切换时自动填 baseUrl/model 默认值，两者仍可手改
const VENDORS = {
  aliyun: {
    name: "阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.8-flash",
    models: ["qwen3.8-flash", "qwen-plus", "qwen-max", "qwen-turbo"],
  },
  zhipu: {
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.3",
    models: ["glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-5"],
  },
  moonshot: {
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
    models: ["kimi-k3", "kimi-k2.7-code", "moonshot-v1-128k"],
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  custom: { name: "自定义", baseUrl: "", model: "", models: [] },
};

// 每个模板的表单定义。加模板 = 加一条。
const FIELDS = {
  "date-card": [],
  quote: [
    { key: "text", type: "textarea", label: "金句", rows: 3, placeholder: "留空则按日从句库轮换" },
    { key: "source", type: "text", label: "出处", placeholder: "可空" },
    { key: "pinned", type: "checkbox", label: "固定这一条（不按日轮换）" },
  ],
  dashboard: [
    { key: "todos", type: "todos", label: "待办", hint: "勾选完成；拖住 ⠿ 排序" },
  ],
  memo: [
    { key: "title", type: "text", label: "标题" },
    { key: "body", type: "textarea", label: "内容", rows: 7 },
  ],
  photo: [
    { key: "path", type: "photo", label: "照片" },
    { key: "caption", type: "text", label: "底部说明", placeholder: "可空" },
    { key: "contrast", type: "range", label: "对比度", min: 0, max: 100 },
  ],
  weather: [
    { key: "city", type: "text", label: "城市名", hint: "只影响屏上显示的文字" },
    { key: "_refresh", type: "button", label: "刷新天气" },
  ],
  countdown: [
    { key: "items", type: "countdown", label: "事件", hint: "一行一条：名称 | 2026-12-01" },
  ],
  almanac: [],
  calendar: [],
  "daily-read": [
    { key: "season", type: "text", label: "季节短句", placeholder: "留空按月份自动" },
    { key: "battery", type: "number", label: "电量 %", placeholder: "100" },
    { key: "footLeft", type: "text", label: "底栏左" },
    { key: "footRight", type: "text", label: "底栏右" },
  ],
  todo: [
    { key: "title", type: "text", label: "标题" },
    { key: "items", type: "todos", label: "待办", urgent: true, hint: "勾选完成；! 标紧急；拖住 ⠿ 排序" },
  ],
  poetry: [
    { key: "source", type: "text", label: "来源标注" },
    { key: "pinned", type: "checkbox", label: "固定这一首（不按日轮换）" },
    { key: "index", type: "number", label: "固定第几首" },
  ],
  word: [
    { key: "tag", type: "text", label: "角标" },
    { key: "left", type: "text", label: "底栏左" },
    { key: "example", type: "text", label: "例句" },
  ],
  habit: [
    { key: "title", type: "text", label: "标题" },
    { key: "habits", type: "habit", label: "习惯", hint: "一行一个：名称 | 101100111001000（0 未做 1 做了 2 半程）" },
  ],
  "ai-card": [
    // 选项和 app/ai-presets.js 保持同步
    {
      key: "preset",
      type: "select",
      label: "预设",
      group: "内容",
      options: [
        ["question", "每日一问"],
        ["riddle", "谜语"],
        ["vocab", "每日一词"],
        ["stoic", "斯多葛"],
        ["thisday", "历史上的今天"],
      ],
    },
    { key: "_gen", type: "button", label: "立即生成（当天缓存）", action: "aiGenerate", group: "内容" },
    { key: "title", type: "text", label: "标题", placeholder: "留空用 AI 生成的内容", group: "内容" },
    { key: "body", type: "textarea", label: "正文", rows: 5, placeholder: "留空用 AI 生成的内容", group: "内容" },
    { key: "foot", type: "text", label: "落款", placeholder: "可空", group: "内容" },
    {
      key: "provider",
      type: "select",
      label: "服务商",
      group: "AI 服务",
      options: Object.entries(VENDORS).map(([id, v]) => [id, v.name]),
      hint: "切换后自动填入默认地址和模型，均可手改",
    },
    {
      key: "baseUrl",
      type: "text",
      label: "API 地址",
      placeholder: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      hint: "OpenAI 兼容接口地址，支持专属端点",
      group: "AI 服务",
    },
    {
      key: "model",
      type: "datalist",
      label: "模型",
      placeholder: "qwen3.8-flash",
      listId: "aiModelList",
      group: "AI 服务",
      // 按当前服务商给建议值，可手输任意名
      options: () => (VENDORS[contentOf("ai-card").provider || "aliyun"] || {}).models || [],
    },
    { key: "apiKey", type: "password", label: "API Key", placeholder: "sk-…", group: "AI 服务" },
  ],
  moyu: [
    { key: "offwork", type: "text", label: "下班时间", placeholder: "18:00", hint: "格式 时:分" },
    {
      key: "extra",
      type: "textarea",
      label: "额外节日",
      rows: 3,
      placeholder: "2026-12-24 | 平安夜\n2027-02-14 | 情人节",
      hint: "一行一条：日期 | 名称",
    },
  ],
  lifebar: [
    { key: "title", type: "text", label: "标题", placeholder: "人生进度" },
    { key: "birthday", type: "text", label: "生日", placeholder: "1995-06-15", hint: "公历生日，格式 年-月-日" },
    { key: "lifespan", type: "number", label: "预期寿命（岁）", placeholder: "80" },
    { key: "foot", type: "text", label: "底栏右", placeholder: "今天也要好好生活" },
  ],
  "year-progress": [
    { key: "title", type: "text", label: "标题" },
    { key: "sub", type: "text", label: "副标题" },
    { key: "marks", type: "marks", label: "节点", hint: "一行一条：日期 | 名称，如 2026-06-01 | 半年" },
  ],
  history: [],
};

let store = null;
let active = "date-card";
let connected = false;
let busy = false;
let currentFrame = null;
let transport = "usb";       // 'usb' | 'wifi'
let deviceIp = "";           // WiFi 通路下的设备地址
let renderTimer = null;
let saveTimer = null;

// ── 日志 ────────────────────────────────────────────────
const logEl = $("log");
function log(text) {
  const t = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  logEl.textContent += `${t}  ${text}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}
window.inkpad.onLog((t) => log(t));

// ── 状态 ────────────────────────────────────────────────
function setStatus(text, kind = "") {
  $("statusText").textContent = text;
  $("statusDot").className = "dot" + (kind ? " " + kind : "");
}
function idleStatus() {
  setStatus(connected ? "已连接" : "未连接", connected ? "on" : "");
}
function setBusy(on, label = "") {
  busy = on;
  document.querySelectorAll("button").forEach((b) => {
    if (b.id === "btnClearLog" || b.id === "btnDebug") return;
    b.disabled = on;
  });
  if (on && label) setStatus(label);
}

// ── 模板列表 ────────────────────────────────────────────
function buildTemplateList() {
  const box = $("tplList");
  // 首次构建列表；之后只切换 active，不重建 DOM，滚动位置不丢
  if (!box.childElementCount) {
    for (const t of TEMPLATES) {
      const b = document.createElement("button");
      b.className = "tpl";
      b.textContent = t.name;
      b.dataset.id = t.id;
      b.addEventListener("click", () => switchTemplate(t.id));
      box.appendChild(b);
    }
  }
  box.querySelectorAll("button.tpl").forEach((b) => b.classList.toggle("active", b.dataset.id === active));
}

function switchTemplate(id) {
  active = id;
  buildTemplateList();
  buildForm();
  window.inkpad.storeUpdate({ active: id }).then((r) => {
    if (r.ok) store = r.data;
  });
  scheduleRender(0);
}

// ── 表单 ────────────────────────────────────────────────
function contentOf(id) {
  return (store && store.content && store.content[id]) || {};
}

/** 待办列表编辑器：勾选完成、! 紧急（urgent 模板）、删除、拖动排序 */
function buildTodosEditor(f, c) {
  const rows = (c[f.key] || []).map((t) => ({
    text: String(t.text || ""),
    done: !!t.done,
    urgent: !!t.urgent,
  }));

  const box = document.createElement("div");
  box.className = "todo-ed";

  const save = () => onFieldChange(f.key, rows.filter((r) => r.text.trim()).map((r) => ({ ...r })));

  function clearMarks() {
    box.querySelectorAll(".drop-before,.drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
  }

  function render() {
    box.innerHTML = "";

    rows.forEach((row, i) => {
      const r = document.createElement("div");
      r.className = "todo-row" + (row.done ? " done" : "");

      // 只有从把手起拖才允许拖动，否则输入框里选文本会被当成拖拽
      const grip = document.createElement("span");
      grip.className = "grip";
      grip.textContent = "⠿";
      grip.addEventListener("mousedown", () => (r.draggable = true));

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = row.done;
      chk.addEventListener("change", () => {
        row.done = chk.checked;
        save();
        render();
      });

      // 输入中不重建，保持焦点
      const txt = document.createElement("input");
      txt.type = "text";
      txt.className = "input";
      txt.value = row.text;
      txt.addEventListener("input", () => {
        row.text = txt.value;
        save();
      });

      const del = document.createElement("button");
      del.className = "tbtn";
      del.textContent = "×";
      del.title = "删除";
      del.addEventListener("click", () => {
        rows.splice(i, 1);
        save();
        render();
      });

      r.append(grip, chk, txt);
      if (f.urgent) {
        const urg = document.createElement("button");
        urg.className = "tbtn flag" + (row.urgent ? " on" : "");
        urg.textContent = "!";
        urg.title = "紧急";
        urg.addEventListener("click", () => {
          row.urgent = !row.urgent;
          save();
          render();
        });
        r.appendChild(urg);
      }
      r.appendChild(del);

      r.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
        r.classList.add("dragging");
      });
      r.addEventListener("dragend", () => {
        r.draggable = false;
        r.classList.remove("dragging");
        clearMarks();
      });
      r.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (r.classList.contains("dragging")) return;
        const rect = r.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        clearMarks();
        r.classList.add(before ? "drop-before" : "drop-after");
        r._dropAt = before ? i : i + 1;
      });
      r.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData("text/plain"));
        if (!Number.isInteger(from) || from === r._dropAt || from + 1 === r._dropAt) {
          return clearMarks();
        }
        let to = r._dropAt;
        const [item] = rows.splice(from, 1);
        if (from < to) to -= 1;
        rows.splice(to, 0, item);
        save();
        render();
      });

      box.appendChild(r);
    });

    const add = document.createElement("button");
    add.className = "ghost small todo-add";
    add.textContent = "+ 添加一条";
    add.addEventListener("click", () => {
      rows.push({ text: "", done: false, urgent: false });
      render();
      const inputs = box.querySelectorAll("input[type=text]");
      inputs[inputs.length - 1].focus();
    });
    box.appendChild(add);
  }

  render();
  return box;
}

/** 倒数日数组 ↔ 文本 */
function itemsToText(list) {
  return (list || []).map((it) => `${it.name} | ${it.date}`).join("\n");
}
function textToItems(text) {
  return String(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, date] = l.split("|").map((s) => (s || "").trim());
      return { name: name || "", date: date || "" };
    })
    .filter((it) => it.name && it.date);
}

/** 习惯数组 ↔ 文本 */
function habitsToText(list) {
  return (list || []).map((h) => `${h.name} | ${(h.days || []).join("")}`).join("\n");
}
function textToHabits(text) {
  return String(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, days] = l.split("|").map((s) => (s || "").trim());
      return { name: name || "", days: String(days || "").split("").map((c) => (c === "1" ? 1 : c === "2" ? 2 : 0)) };
    })
    .filter((h) => h.name);
}

/** 节点数组 ↔ 文本 */
function marksToText(list) {
  return (list || []).map((m) => `${m.date || ""} | ${m.name || ""}`).join("\n");
}
function textToMarks(text) {
  return String(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [date, name] = l.split("|").map((s) => (s || "").trim());
      return { date: date || "", name: name || "" };
    })
    .filter((m) => m.date);
}

/** 从存储取表单初值 */
function fieldValue(f, c) {
  if (f.type === "countdown") return itemsToText(c.items);
  if (f.type === "habit") return habitsToText(c.habits);
  if (f.type === "marks") return marksToText(c.marks);
  return c[f.key] === undefined || c[f.key] === null ? "" : c[f.key];
}

/** 把表单值转回存储格式 */
function fieldToStore(f, text) {
  if (f.type === "countdown") return textToItems(text);
  if (f.type === "habit") return textToHabits(text);
  if (f.type === "marks") return textToMarks(text);
  return text;
}

function buildForm() {
  const tpl = TEMPLATES.find((t) => t.id === active);
  $("formTitle").textContent = tpl ? tpl.name : "内容";
  const body = $("formBody");
  body.innerHTML = "";

  const fields = FIELDS[active] || [];
  if (!fields.length) {
    body.innerHTML = `<div class="card"><p class="hint">这个模板不需要填内容，内容按当天日期自动生成。</p></div>`;
    return;
  }

  const c = contentOf(active);

  // 字段按 group 分组进卡片；无 group 的字段归一张无标题卡
  let curGroup = null;
  let host = null;

  for (const f of fields) {
    const g = f.group ?? "";
    if (g !== curGroup) {
      host = document.createElement("div");
      host.className = "card";
      if (g) {
        const h = document.createElement("div");
        h.className = "card-title";
        h.textContent = g;
        host.appendChild(h);
      }
      body.appendChild(host);
      curGroup = g;
    }

    const wrap = document.createElement("div");
    wrap.className = "field";

    if (f.type === "button") {
      const btn = document.createElement("button");
      btn.className = "ghost";
      btn.textContent = f.label;
      btn.addEventListener("click", f.action === "aiGenerate" ? aiGenerate : refreshWeather);
      wrap.appendChild(btn);
      host.appendChild(wrap);
      continue;
    }

    if (f.type === "select") {
      const label = document.createElement("label");
      label.textContent = f.label;
      wrap.appendChild(label);
      const sel = document.createElement("select");
      sel.className = "input";
      for (const [v, name] of f.options) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = name;
        sel.appendChild(o);
      }
      sel.value = c[f.key] || f.options[0][0];
      sel.addEventListener("change", () => {
        onFieldChange(f.key, sel.value);
        // 服务商切换联动填默认值，只在用户主动操作时触发
        if (f.key === "provider") applyVendor(sel.value);
      });
      wrap.appendChild(sel);
      if (f.hint) {
        const h = document.createElement("div");
        h.className = "field-hint";
        h.textContent = f.hint;
        wrap.appendChild(h);
      }
      host.appendChild(wrap);
      continue;
    }

    if (f.type === "todos") {
      wrap.appendChild(buildTodosEditor(f, c));
      host.appendChild(wrap);
      continue;
    }

    const label = document.createElement("label");
    label.textContent = f.label;
    wrap.appendChild(label);

    let el;
    const MULTI = ["textarea", "countdown", "habit", "marks"];
    if (MULTI.includes(f.type)) {
      el = document.createElement("textarea");
      el.rows = f.rows || (f.type === "textarea" ? 4 : 6);
      if (f.placeholder) el.placeholder = f.placeholder;
      el.value = fieldValue(f, c);
      el.addEventListener("input", () => onFieldChange(f.key, fieldToStore(f, el.value)));
    } else if (f.type === "checkbox") {
      el = document.createElement("input");
      el.type = "checkbox";
      el.checked = !!c[f.key];
      el.addEventListener("change", () => onFieldChange(f.key, el.checked));
      const row = document.createElement("label");
      row.className = "check-row";
      row.appendChild(el);
      row.appendChild(document.createTextNode(" " + f.label));
      wrap.innerHTML = "";
      wrap.appendChild(row);
      host.appendChild(wrap);
      continue;
    } else if (f.type === "range") {
      el = document.createElement("input");
      el.type = "range";
      el.min = f.min;
      el.max = f.max;
      el.value = c[f.key] ?? 55;
      const val = document.createElement("span");
      val.className = "range-val";
      val.textContent = el.value;
      el.addEventListener("input", () => {
        val.textContent = el.value;
        onFieldChange(f.key, Number(el.value));
      });
      const row = document.createElement("div");
      row.className = "range-row";
      row.appendChild(el);
      row.appendChild(val);
      wrap.appendChild(row);
      host.appendChild(wrap);
      continue;
    } else if (f.type === "photo") {
      el = document.createElement("div");
      el.className = "photo-row";
      const txt = document.createElement("div");
      txt.className = "photo-path";
      txt.textContent = c.path || "未选择";
      const btn = document.createElement("button");
      btn.className = "ghost small";
      btn.textContent = "选择…";
      btn.addEventListener("click", async () => {
        const r = await window.inkpad.pickPhoto();
        if (!r.ok) return;
        txt.textContent = r.path;
        onFieldChange("path", r.path);
      });
      el.appendChild(txt);
      el.appendChild(btn);
      wrap.appendChild(el);
      host.appendChild(wrap);
      continue;
    } else {
      el = document.createElement("input");
      el.type = f.type === "number" ? "number" : f.type === "password" ? "password" : "text";
      el.dataset.key = f.key;
      if (f.placeholder) el.placeholder = f.placeholder;
      el.value = fieldValue(f, c);
      el.addEventListener("input", () =>
        onFieldChange(f.key, f.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value)
      );
      // datalist 类型：可下拉选建议模型，也可手输任意名
      if (f.type === "datalist") {
        el.setAttribute("list", f.listId);
        const dl = document.createElement("datalist");
        dl.id = f.listId;
        const opts = typeof f.options === "function" ? f.options() : f.options || [];
        for (const m of opts) {
          const o = document.createElement("option");
          o.value = m;
          dl.appendChild(o);
        }
        wrap.appendChild(dl);
      }
    }

    if (!MULTI.includes(f.type)) el.className = "input";
    wrap.appendChild(el);
    if (f.hint) {
      const h = document.createElement("div");
      h.className = "field-hint";
      h.textContent = f.hint;
      wrap.appendChild(h);
    }
    host.appendChild(wrap);
  }
}

/** 多字段一次落盘（350ms 防抖合并，避免连改两键只存后者） */
function onFieldsChange(patch) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const r = await window.inkpad.storeUpdate({ content: { [active]: patch } });
    if (r.ok) store = r.data;
    scheduleRender();
  }, 350);
}

function onFieldChange(key, value) {
  onFieldsChange({ [key]: value });
}

/** 服务商切换 → 填默认 baseUrl/model（自定义不动现有值），就地刷新输入框和模型建议 */
function applyVendor(id) {
  const v = VENDORS[id];
  if (!v) return;
  const patch = { provider: id };
  if (id !== "custom") {
    patch.baseUrl = v.baseUrl;
    patch.model = v.model;
    const base = document.querySelector('#formBody input[data-key="baseUrl"]');
    const model = document.querySelector('#formBody input[data-key="model"]');
    if (base) base.value = v.baseUrl;
    if (model) model.value = v.model;
    const dl = $("aiModelList");
    if (dl) {
      dl.innerHTML = "";
      for (const m of v.models || []) {
        const o = document.createElement("option");
        o.value = m;
        dl.appendChild(o);
      }
    }
  }
  onFieldsChange(patch);
}

// ── 渲染 ────────────────────────────────────────────────
function scheduleRender(delay = 400) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, delay);
}

async function render() {
  $("previewMask").classList.remove("hide");
  $("previewMask").textContent = "渲染中…";
  const r = await window.inkpad.render(active);
  $("previewMask").classList.add("hide");

  if (!r.ok) {
    log("渲染失败：" + r.error);
    $("previewMask").classList.remove("hide");
    $("previewMask").textContent = "渲染失败";
    return;
  }
  $("preview").src = r.preview;
  currentFrame = r.frame;
  $("renderMeta").textContent = `${r.size.width}×${r.size.height} · 渲染 ${r.ms} ms`;
}

// ── 推送 ────────────────────────────────────────────────
async function push() {
  if (!currentFrame) return log("还没有可推送的画面");
  if (busy) return;

  if (transport === "wifi") {
    if (!deviceIp) return log("还没找到设备，先点「自动发现」或手填 IP");
    setBusy(true, "通过 WiFi 推送中…（约 14 秒）");
    const r = await window.inkpad.wifiPush(deviceIp, currentFrame);
    setBusy(false);
    if (!r.ok) log("WiFi 推送失败：" + r.error);
    else log("WiFi 推送完成");
    return;
  }

  if (!connected) return log("先连接设备");
  setBusy(true, "推送中…（约 14 秒）");
  const r = await window.inkpad.pushBytes(currentFrame);
  setBusy(false);
  idleStatus();
  if (!r.ok) log("推送失败：" + r.error);
  else log(`推送完成（${r.result}）`);
}

// ── 通路切换 ────────────────────────────────────────────
function setTransport(t) {
  transport = t;
  document.querySelectorAll("#transportSeg .seg-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.t === t);
  });
  $("portSelect").style.display = t === "usb" ? "" : "none";
  log("通路已切到 " + (t === "usb" ? "USB" : "WiFi"));
}

// ── AI 卡片 ─────────────────────────────────────────────
async function aiGenerate() {
  if (busy) return;
  const c = contentOf("ai-card");
  setBusy(true, "AI 生成中…（最多等 45 秒）");
  const r = await window.inkpad.aiGenerate(c.preset || "question");
  setBusy(false);
  if (!r.ok) {
    const msg = "生成失败：" + r.error + (r.noKey ? " —— 先在下面填 API Key" : "");
    setStatus(msg.slice(0, 60), "err"); // 顶栏红点提示，错误不止埋在调试抽屉里
    return log(msg);
  }
  idleStatus();
  log(`已生成（${r.from === "cache" ? "当天缓存" : "AI 接口"}）：${r.card.title}`);
  scheduleRender(0);
}

// ── 天气 ────────────────────────────────────────────────
async function refreshWeather() {
  log("正在拉取天气…");
  const r = await window.inkpad.weatherRefresh();
  if (r.ok) {
    log(`天气：${r.cache.cond} ${r.cache.temp}°（${r.cache.hi}°/${r.cache.lo}°）`);
  } else {
    log("天气拉取失败：" + r.error + (r.cache ? "，继续用缓存" : ""));
  }
  const s = await window.inkpad.storeGet();
  store = s;
  scheduleRender(0);
}

// ── 设备 ────────────────────────────────────────────────
async function refreshPorts() {
  const list = await window.inkpad.listPorts();
  if (list && list.error) {
    log("枚举串口失败：" + list.error);
    return [];
  }
  const sel = $("portSelect");
  sel.innerHTML = '<option value="">— 串口 —</option>';
  for (const p of list) {
    const o = document.createElement("option");
    o.value = p.path;
    o.textContent = p.path + (p.label ? " (" + p.label.split(" ")[0] + ")" : "");
    sel.appendChild(o);
  }
  if (!list.length) log("没有发现串口，检查 USB 是否插好");
  return list;
}

async function connect() {
  const p = $("portSelect").value;
  if (!p) return log("先选串口");
  setBusy(true, "连接中…");
  const r = await window.inkpad.open(p);
  setBusy(false);
  if (!r.ok) {
    setStatus("连接失败", "err");
    return log("连接失败：" + r.error);
  }
  connected = true;
  $("btnConnect").textContent = "断开";
  idleStatus();
  const info = r.info || {};
  $("devInfo").textContent = `${info.drv || "?"} · ${info.w || "?"}×${info.h || "?"} · cal=${info.cal ?? "?"}`;
  if (info.cal !== undefined) $("calSelect").value = String(info.cal);
  log(`已连接 ${p}：${info.drv} ${info.w}×${info.h} fw=${info.fw}`);
  // 记住这次用的口，下次启动自动重连
  const r2 = await window.inkpad.storeUpdate({ device: { port: p } });
  if (r2.ok) store = r2.data;
}

async function disconnect() {
  await window.inkpad.close();
  connected = false;
  $("btnConnect").textContent = "连接";
  $("devInfo").textContent = "未连接设备";
  idleStatus();
  // 主动断开就不再自动重连
  const r = await window.inkpad.storeUpdate({ device: { port: "" } });
  if (r.ok) store = r.data;
}

// ── WiFi 副通路 ─────────────────────────────────────────
const wifiLogEl = $("wifiLog");
function wifiLog(t) {
  wifiLogEl.textContent += t + "\n";
  wifiLogEl.scrollTop = wifiLogEl.scrollHeight;
  log("[WiFi] " + t);
}

function setWifiStatus(t) {
  $("wifiStatus").textContent = t;
}

async function discoverDevice() {
  setWifiStatus("正在查找设备…");
  wifiLog("查找中（先试 mDNS，再试 UDP 广播）…");
  const r = await window.inkpad.wifiDiscover();
  if (!r.ok) {
    setWifiStatus("查找失败：" + r.error);
    return;
  }
  if (!r.found) {
    setWifiStatus("没找到设备。屏可能在另一个网段，或还没连上 WiFi。");
    wifiLog("没找到。可用「配置模式」让屏开热点，电脑连上它的热点后填 192.168.4.1。");
    return;
  }
  deviceIp = r.found.ip;
  $("wifiIp").value = deviceIp;
  setWifiStatus(`已找到：${deviceIp}（${r.found.via}）`);
  wifiLog(`发现 ${deviceIp}，方式 ${r.found.via}`);

  const info = await window.inkpad.wifiInfo(deviceIp);
  if (info.ok) wifiLog(`设备信息：${JSON.stringify(info.info)}`);
  else wifiLog("读设备信息失败：" + info.error);
}

async function testDevice() {
  const ip = $("wifiIp").value.trim() || deviceIp;
  if (!ip) return wifiLog("先填 IP 或自动发现");
  deviceIp = ip;
  setWifiStatus("测试中…");
  const r = await window.inkpad.wifiPing(deviceIp);
  if (r.ok && r.alive) {
    setWifiStatus(`${ip} 在线`);
    wifiLog(`${ip} 在线`);
  } else {
    setWifiStatus(`${ip} 连不上`);
    wifiLog(`${ip} 连不上：${r.error || "无响应"}`);
  }
}

async function apMode() {
  if (!connected) return wifiLog("配置模式需要先用 USB 连着设备");
  wifiLog("让屏开启热点…");
  const r = await window.inkpad.rawCmd("MODE ap", "^(OK|AP|ERR)", 20000);
  if (!r.ok) return wifiLog("失败：" + r.error);
  const apLine = r.lines.find((l) => l.startsWith("AP OK"));
  if (apLine) {
    const parts = apLine.split(" ");
    const ssid = parts[2];
    const pass = parts[3];
    wifiLog(`热点已开：${ssid} / ${pass}`);
    wifiLog("请在电脑右下角的 WiFi 里连上它，然后填 IP 192.168.4.1");
    $("wifiIp").value = "192.168.4.1";
    deviceIp = "192.168.4.1";
    setWifiStatus("等待电脑连上屏的热点");
  } else {
    wifiLog("没拿到热点信息：" + r.lines.join(" | "));
  }
}

async function scanWifi() {
  if (!connected) return wifiLog("扫描需要先用 USB 连着设备");
  wifiLog("扫描周围网络…");
  const r = await window.inkpad.rawCmd("SCAN", "^SCANDONE", 20000);
  if (!r.ok) return wifiLog("扫描失败：" + r.error);
  const nets = r.lines.filter((l) => l.startsWith("SSID "));
  if (!nets.length) return wifiLog("没扫到网络");
  for (const n of nets) wifiLog("  " + n.slice(5));
  wifiLog(`共 ${nets.length} 个`);
}

// ── 调试动作 ────────────────────────────────────────────
function guard() {
  if (!connected) {
    log("先连接设备");
    return false;
  }
  return !busy;
}

async function runTest() {
  if (!guard()) return;
  setBusy(true, "刷测试图中…");
  const r = await window.inkpad.test();
  setBusy(false);
  idleStatus();
  log(r.ok ? "测试图完成" : "失败：" + r.error);
}

async function runSolid(color, label) {
  if (!guard()) return;
  setBusy(true, `推${label}中…`);
  const r = await window.inkpad.solid(color);
  setBusy(false);
  idleStatus();
  log(r.ok ? `推${label}完成` : `推${label}失败：` + r.error);
}

async function runCal() {
  if (!guard()) return;
  const v = $("calSelect").value;
  setBusy(true, "写入极性…");
  const r = await window.inkpad.cmd("CAL " + v);
  setBusy(false);
  idleStatus();
  log(r.ok ? `极性已写入 cal=${v}` : "写入失败：" + r.error);
}

// ── 绑定 ────────────────────────────────────────────────
$("btnRefresh").addEventListener("click", refreshPorts);
$("btnConnect").addEventListener("click", async () => (connected ? disconnect() : connect()));
$("btnPush").addEventListener("click", push);
$("btnTest").addEventListener("click", runTest);
$("btnWhite").addEventListener("click", () => runSolid("white", "全白"));
$("btnBlack").addEventListener("click", () => runSolid("black", "全黑"));
$("btnRed").addEventListener("click", () => runSolid("red", "全红"));
$("btnCal").addEventListener("click", runCal);
$("btnClearLog").addEventListener("click", () => (logEl.textContent = ""));

$("btnWifi").addEventListener("click", () => $("wifiPanel").classList.remove("hide"));
$("btnWifiClose").addEventListener("click", () => $("wifiPanel").classList.add("hide"));
$("btnDiscover").addEventListener("click", discoverDevice);
$("btnWifiPing").addEventListener("click", testDevice);
$("btnApMode").addEventListener("click", apMode);
$("btnScanWifi").addEventListener("click", scanWifi);

document.querySelectorAll("#transportSeg .seg-btn").forEach((b) => {
  b.addEventListener("click", () => setTransport(b.dataset.t));
});

$("btnDebug").addEventListener("click", () => $("debugPanel").classList.remove("hide"));
$("btnDebugClose").addEventListener("click", () => $("debugPanel").classList.add("hide"));

// ── 启动 ────────────────────────────────────────────────
(async function boot() {
  store = await window.inkpad.storeGet();
  active = store.active || "date-card";
  buildTemplateList();
  buildForm();
  const ports = await refreshPorts();
  // 上次连过的口还在，就直接连上
  const last = store.device && store.device.port;
  if (last) {
    if (ports.some((p) => p.path === last)) {
      $("portSelect").value = last;
      log(`自动连接上次的串口 ${last}`);
      connect();
    } else {
      log(`上次的串口 ${last} 这次没找到，需要时手动选择`);
    }
  }
  scheduleRender(0);
  log("墨签 InkPad · 内容模板");
})();

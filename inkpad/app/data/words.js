/**
 * CET4 词库解析
 *
 * 源文件 app/data/cet4.txt（4615 词，格式）：
 *   大学英语四级大纲单词表 (共 4615 词)
 *   abandon [əˈbændən] vt.丢弃；放弃，抛弃
 *
 * 解析出来缓存住，避免每次渲染都读文件。
 */

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "cet4.txt");
let cache = null;

function parse() {
  if (cache) return cache;
  let raw = "";
  try {
    raw = fs.readFileSync(FILE, "utf8");
  } catch (_) {
    cache = [];
    return cache;
  }

  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    // 跳过标题行
    if (s.includes("共") && s.includes("词表")) continue;

    // 形如：word [音标] 释义
    const m = s.match(/^([A-Za-z][A-Za-z'’-]*)\s*(?:\[([^\]]*)\])?\s*(.*)$/);
    if (!m) continue;
    const word = m[1];
    const phonetic = m[2] ? `/${m[2]}/` : "";
    const meaning = (m[3] || "").trim();
    if (!meaning) continue;
    out.push({ word, phonetic, meaning });
  }
  cache = out;
  return cache;
}

/** 按天轮换取一个词（用日期做种子，同一天永远是同一个） */
function pickByDate(date) {
  const list = parse();
  if (!list.length) return null;
  const seed = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  return list[seed % list.length];
}

function count() {
  return parse().length;
}

module.exports = { parse, pickByDate, count };

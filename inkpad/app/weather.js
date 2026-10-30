/**
 * 天气：Open-Meteo（免费、不用 API key、不用注册）
 *
 * 断网策略：抓不到就用上一次的缓存，并在画面上标「离线 + 数据时间」；
 * 从来没抓到过就返回 null，模板显示 --，不报错、不弹窗。
 */

const https = require("https");

const DEFAULT_LOCATION = {
  city: "深圳",
  lat: 22.5431,
  lon: 114.0579,
};

// WMO weather code → 中文
const CODE_TEXT = {
  0: "晴",
  1: "少云",
  2: "多云",
  3: "阴",
  45: "雾",
  48: "雾凇",
  51: "毛毛雨",
  53: "毛毛雨",
  55: "毛毛雨",
  56: "冻雨",
  57: "冻雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨",
  67: "冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "雪粒",
  80: "阵雨",
  81: "阵雨",
  82: "强阵雨",
  85: "阵雪",
  86: "阵雪",
  95: "雷阵雨",
  96: "雷阵雨",
  99: "雷暴冰雹",
};

function getJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "inkpad/0.1" } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("HTTP " + res.statusCode));
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error("返回内容不是 JSON"));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("请求超时")));
  });
}

/** 风速 km/h → 蒲福风力等级 */
function windLevel(kmh) {
  const t = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 117];
  let lv = t.findIndex((hi) => kmh < hi);
  if (lv === -1) lv = 12;
  return lv;
}

/**
 * 拉一次天气
 * @returns {Promise<{temp:number, hi:number, lo:number, humidity:number, feels:number, wind:number, windText:string, code:number, cond:string, at:string}>}
 */
async function fetchWeather(location = DEFAULT_LOCATION) {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${location.lat}&longitude=${location.lon}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m" +
    "&daily=temperature_2m_max,temperature_2m_min" +
    "&timezone=Asia%2FShanghai&forecast_days=1";

  const j = await getJson(url);
  const cur = j.current || {};
  const daily = j.daily || {};
  const code = Number(cur.weather_code ?? -1);

  const wind = Math.round(Number(cur.wind_speed_10m ?? NaN));
  return {
    temp: Math.round(Number(cur.temperature_2m)),
    hi: Math.round(Number((daily.temperature_2m_max || [NaN])[0])),
    lo: Math.round(Number((daily.temperature_2m_min || [NaN])[0])),
    humidity: Math.round(Number(cur.relative_humidity_2m ?? NaN)),
    feels: Math.round(Number(cur.apparent_temperature ?? NaN)),
    wind,
    windText: Number.isFinite(wind) ? `${windLevel(wind)} 级` : "--",
    code,
    cond: CODE_TEXT[code] || "未知",
    at: new Date().toISOString(),
  };
}

module.exports = { fetchWeather, DEFAULT_LOCATION, CODE_TEXT };

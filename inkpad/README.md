# 墨签 InkPad

4.2 寸 400×300 红黑白三色电子价签屏（ESP32-C3 + SSD1619）× Windows Electron 桌面应用：编辑 → 预览 → USB 一键推送到墨水屏。所见即所推，双击即用。

## 快速开始

### 使用（打包版）

`dist/墨签-win/墨签.exe` 双击即用（便携版，免安装、免 Python/Node 环境）。

1. USB 连屏；应用自动匹配上次串口（首次手动选 COM 口，按 VID_303A/PID_1001 过滤）
2. 顶部选模板 → 右侧编辑内容 → 左侧预览即上屏效果
3. 「推送到屏幕」，约 13 秒完成全刷（相同内容自动跳过）

### 开发

```bash
node tools/selftest.js                            # 环境自检
./node_modules/.bin/electron .                    # 开发版运行
./node_modules/.bin/electron tools/render-test.js # 19 模板全量渲染回归（看 EXIT 码）
bash build-win.sh                                 # 打包便携版到 dist/墨签-win
```

日志：`%APPDATA%\inkpad\app.log`（应用）、`out/render-test.log`（回归明细）。

## 19 个模板

日期牌 · 金句 · 信息看板 · 备忘录 · 相框 · 天气 · 倒数日 · 老黄历 · 日历 · 日读 · 待办 · 诗词 · 每日一词 · 习惯 · AI 卡片 · 摸鱼日历 · 人生进度 · 年进度 · 今日历史

设计语言对齐 [InkSight](https://www.inksight.site/zh/preview)：衬线字体（宋体/Georgia）、红 #d02020 点睛、底部虚线 + 居中红色短分隔线。样式权威参照 `.refs/inksight-modes/`。

## 目录结构

```
inkpad/
├── app/            主进程：main.js（IPC）/ render.js（离屏渲染）
│                   / dither.js（三色量化）/ transport-usb.js / store.js
│                   / weather.js / ai.js / templates.js + templates-extra.js
├── ui/             渲染端：index.html / app.js / style.css
│   └── templates/  19 个模板 HTML（{{key}} 占位）
├── tools/          selftest.js / render-test.js
├── assets/         图标资源
├── .refs/          inksight-modes/（28 个模式布局 JSON，样式参照）
├── PRD.md          产品需求文档（随版本维护）
├── CHANGELOG.md    版本记录
└── build-win.sh    打包脚本
```

## 文档索引

| 文档 | 作用 |
|---|---|
| [`PRD.md`](PRD.md) | 产品需求文档（协议/模板/设计规范/里程碑，随版本维护） |
| [`CHANGELOG.md`](CHANGELOG.md) | 每轮发布的全部变更记录 |
| [`../HANDOVER.md`](../HANDOVER.md) | 会话交接快照（每轮覆盖更新，含环境坑清单） |
| [`../PLAN-inkpad.md`](../PLAN-inkpad.md) | 动工前方案 v2（2026-10-26，历史档案） |

## 硬件

- 4.2 寸 400×300 三色墨水屏（SSD1619），ESP32-C3 原生 USB CDC
- 串口：COM12（VID_303A/PID_1001），极性校准 cal=2
- 帧格式：2bpp 30000 字节 + CRC32；调色板 `0=黑 1=白 2=黄 3=红`（本屏黄显示为红）
- 刷屏期间不断串口只等 DONE；WiFi 副通路固件已含、默认关闭（M6 打通）

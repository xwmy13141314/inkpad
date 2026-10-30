# 墨签 InkPad

4.2 寸 400×300 红黑白三色电子墨水屏（ESP32-C3 + SSD1619）+ Windows Electron 桌面应用：
在电脑上编辑内容 → 离屏渲染并量化成三色 → 串口推送到墨水屏显示。

一张屏，一天一换的桌面信息牌。

## 仓库结构

| 目录 | 说明 |
|---|---|
| `inkpad/` | Windows 桌面应用（Electron）：19 个屏显模板、三色量化渲染、串口/WIFI 推送，详见 [`inkpad/README.md`](inkpad/README.md) |
| `firmware_usb/` | ESP32-C3 固件（PlatformIO）：USB CDC 串口主通路 + WiFi HTTP 副通路，串口协议详见 [`firmware_usb/PROTOCOL.md`](firmware_usb/PROTOCOL.md) |

## 功能一览

- **19 个模板**：日期牌、金句、信息看板、备忘录、相框、天气、倒数日、老黄历、日历、日读、待办、诗词、每日一词、习惯打卡、AI 卡片、摸鱼日历、人生进度、年进度、今日历史
- **所见即所推**：模板即 HTML/CSS，离屏渲染出 400×300 真实像素后做三色量化（threshold / FS 抖动），预览与上屏完全一致
- **推送通路**：USB 串口（主）；WiFi HTTP（副，M6）——含 mDNS 发现、UDP 扫描、SoftAP 配网
- **红色点缀**：三色屏的红色通道专门用于重点信息（大数字、日期、进度条、打卡格）

## 快速开始

桌面端（Windows）：

```bash
cd inkpad
npm install
npm start          # 开发运行
bash build-win.sh  # 打包便携版（产物在 dist/墨签-win/）
```

固件（PlatformIO）：

```bash
cd firmware_usb
pio run -e esp32c3-usb -t upload --upload-port COM12
```

## 文档

- [`inkpad/PRD.md`](inkpad/PRD.md) —— 产品需求与设计规范（模板视觉体系、量化参数）
- [`inkpad/CHANGELOG.md`](inkpad/CHANGELOG.md) —— 版本更新日志
- [`firmware_usb/PROTOCOL.md`](firmware_usb/PROTOCOL.md) —— 串口/WiFi 通信协议

## 隐私说明

应用的个人数据（备忘、待办、天气位置、AI API Key 等）全部存在本机
`%APPDATA%\inkpad\data.json`，不进仓库；AI 请求直连你自己配置的服务商。

## License

[MIT](LICENSE)

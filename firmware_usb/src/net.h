// WiFi 副通路（M6）
//
// 目标：屏不插电脑也能被推图。核心是解决老固件"服务器 IP 硬编码"的问题——
// 设备用 mDNS 广播自己（inkpad.local），电脑按名字找它，IP 变了也不影响。
//
// 注意：WiFi 射频开着的时候刷墨水屏会干扰波形，所以刷屏前会断开射频，
//      刷完再连上（沿用 epd42_weather 的做法）。
#pragma once

#include <Arduino.h>
#include <stdint.h>
#include <stddef.h>

#define NET_PORT 80
#define NET_MDNS_NAME "inkpad"

// ── 生命周期 ───────────────────────────────────────────────
void netInit();                       // 初始化（STA 模式）
bool netConnect(const char *ssid, const char *pass, uint32_t timeoutMs);
bool netConnected();
String netIP();
String netSSID();

// ── 扫描 ───────────────────────────────────────────────────
int netScan();                       // 返回网络数量
const char *netScanSSID(int i);
int netScanRSSI(int i);

// 刷屏断射频后，用上次热点的凭据原样重开（凭据是随机生成的，必须存下来）
bool netRestartAP();

// ── HTTP 服务 ──────────────────────────────────────────────
// 自己实现而不是用 WebServer：需要接收 30000 字节的二进制 POST body，
// WebServer 对非表单 body 的处理不可控，自己写更省心。
// SoftAP 配置模式：屏自己开热点，电脑连上来就能配网/推图
bool netStartAP(const char *ssid, const char *pass);
bool netInAP();

// UDP 广播探测：电脑广播 INKPAD?，设备回应自己的 IP
// （mDNS 在 Windows 上不一定能解析 .local，所以留这条兜底）
#define NET_DISCOVER_PORT 45353
#define NET_PROBE "INKPAD?"

void netStartServer();
void netStopServer();
void netLoop();                       // 收请求

// 由 main.cpp 提供：处理收到的帧
void netOnFrame(uint8_t *data, size_t len, uint32_t crc);
// 由 main.cpp 提供：请求刷屏（设备会先断射频）
void netOnShow(uint32_t crc);

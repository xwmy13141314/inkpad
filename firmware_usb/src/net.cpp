#include "net.h"

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WiFiUdp.h>

static WiFiServer server(NET_PORT);
static bool serverRunning = false;
static bool mdnsStarted = false;
static WiFiUDP udp;
static bool udpRunning = false;

// 扫描结果缓存
static int scanCount = 0;
static char scanSSIDs[20][33];
static int scanRSSIs[20];

// ── 生命周期 ───────────────────────────────────────────────
void netInit() {
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);   // 桌面摆件不需要省电，唤醒快一点
}

bool netConnect(const char *ssid, const char *pass, uint32_t timeoutMs) {
    if (!ssid || !*ssid) return false;

    WiFi.begin(ssid, pass);
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED) {
        delay(200);
        if (millis() - t0 > timeoutMs) {
            Serial.printf("[NET] 连接 %s 超时\n", ssid);
            WiFi.disconnect(true);
            return false;
        }
    }
    Serial.printf("[NET] 已连接 %s IP=%s\n", ssid, WiFi.localIP().toString().c_str());
    // mDNS 的启动收拢在 netStartServer()：连接和起服务是两件事，
    // 各管各的，谁也不依赖谁的状态
    return true;
}

bool netConnected() { return WiFi.status() == WL_CONNECTED; }
String netIP() { return WiFi.localIP().toString(); }
String netSSID() { return WiFi.SSID(); }

// ── SoftAP 配置模式 ───────────────────────────────────────
bool netInAP() { return WiFi.getMode() == WIFI_AP; }

// 热点凭据是随机生成的，只存在局部变量里会丢——
// 刷屏断射频后要原样重开同一个热点，电脑才不用重连
static char apSsidSave[33] = {0};
static char apPassSave[65] = {0};

bool netStartAP(const char *ssid, const char *pass) {
    if (!ssid || !*ssid) return false;
    strncpy(apSsidSave, ssid, sizeof(apSsidSave) - 1);
    strncpy(apPassSave, pass ? pass : "", sizeof(apPassSave) - 1);
    WiFi.mode(WIFI_AP);
    bool ok = pass && *pass ? WiFi.softAP(ssid, pass) : WiFi.softAP(ssid);
    if (!ok) {
        Serial.println("[NET] SoftAP 启动失败");
        return false;
    }
    delay(200);
    Serial.printf("[NET] SoftAP 已启动 SSID=%s IP=%s\n", ssid, WiFi.softAPIP().toString().c_str());

    netStartServer();
    return true;
}

bool netRestartAP() {
    if (!apSsidSave[0]) return false;
    return netStartAP(apSsidSave, apPassSave);
}

// ── 扫描 ───────────────────────────────────────────────────
int netScan() {
    scanCount = 0;
    int n = WiFi.scanNetworks(false, true);   // 同步扫描，不显示 SSID
    for (int i = 0; i < n && scanCount < 20; i++) {
        const char *ssid = WiFi.SSID(i).c_str();
        if (!ssid || !*ssid) continue;
        strncpy(scanSSIDs[scanCount], ssid, 32);
        scanSSIDs[scanCount][32] = 0;
        scanRSSIs[scanCount] = WiFi.RSSI(i);
        scanCount++;
    }
    WiFi.scanDelete();
    Serial.printf("[NET] 扫描到 %d 个网络\n", scanCount);
    return scanCount;
}

const char *netScanSSID(int i) { return (i >= 0 && i < scanCount) ? scanSSIDs[i] : ""; }
int netScanRSSI(int i) { return (i >= 0 && i < scanCount) ? scanRSSIs[i] : 0; }

// ── HTTP 服务 ──────────────────────────────────────────────
void netStartServer() {
    // 全量重建，不能按标志位跳过：射频模式切换（STA↔AP、断射频重连）会把
    // 底层的 TCP listen / UDP / mDNS 清掉，而标志位还残留 true，跳过重建的话
    // 端口从此失灵（实测 MODE ap 就踩在这：serverRunning 残留 → ECONNREFUSED）
    netStopServer();

    server.begin();
    server.setNoDelay(true);
    serverRunning = true;

    udp.begin(NET_DISCOVER_PORT);
    udpRunning = true;

    if (!mdnsStarted) {
        if (MDNS.begin(NET_MDNS_NAME)) {
            MDNS.addService("http", "tcp", NET_PORT);
            mdnsStarted = true;
        }
    }
    Serial.printf("[NET] HTTP 服务已启动 :%d（发现 :%d%s）\n",
                  NET_PORT, NET_DISCOVER_PORT, mdnsStarted ? "，mDNS 已启动" : "");
}

void netStopServer() {
    if (serverRunning) {
        server.stop();
        serverRunning = false;
    }
    // UDP 一并下线：射频关闭后底层已死，标志位不清掉的话重连后不会重建。
    // mDNS 只清标志位不调 MDNS.end()——core 2.17 上 end() 实测会死锁
    // （MODE usb 命令处理到这就再无任何串口输出）。重启覆盖用 MDNS.begin() 就行。
    if (udpRunning) {
        udp.stop();
        udpRunning = false;
    }
    mdnsStarted = false;
}

static void sendResponse(WiFiClient &c, int code, const char *status, const char *body) {
    char head[160];
    snprintf(head, sizeof(head),
             "HTTP/1.1 %d %s\r\n"
             "Content-Type: application/json; charset=utf-8\r\n"
             "Content-Length: %u\r\n"
             "Connection: close\r\n\r\n",
             code, status, (unsigned)strlen(body));
    c.print(head);
    c.print(body);
    c.flush();
    c.stop();
}

static void sendBinary(WiFiClient &c, int code, const char *status, const uint8_t *data, size_t len) {
    char head[160];
    snprintf(head, sizeof(head),
             "HTTP/1.1 %d %s\r\n"
             "Content-Type: application/octet-stream\r\n"
             "Content-Length: %u\r\n"
             "Connection: close\r\n\r\n",
             code, status, (unsigned)len);
    c.print(head);
    c.write(data, len);
    c.flush();
    c.stop();
}

/** 解析请求行和头，返回 Content-Length（没有则 0） */
static bool readRequest(WiFiClient &c, String &method, String &path, uint32_t &contentLength) {
    method = "";
    path = "";
    contentLength = 0;

    c.setTimeout(3000);
    String line = c.readStringUntil('\n');
    if (!line) return false;

    int sp1 = line.indexOf(' ');
    if (sp1 < 0) return false;
    method = line.substring(0, sp1);
    String rest = line.substring(sp1 + 1);
    rest.trim();
    int sp2 = rest.indexOf(' ');
    path = (sp2 > 0) ? rest.substring(0, sp2) : rest;

    // 头
    while (c.connected()) {
        String h = c.readStringUntil('\n');
        if (h.length() <= 1) break;  // 空行，头结束
        if (h.startsWith("Content-Length:")) {
            contentLength = (uint32_t)strtoul(h.substring(15).c_str(), nullptr, 10);
        }
    }
    return true;
}

void netLoop() {
    // UDP 探测：有人问"你在哪"，就回自己的 IP
    // （mDNS 在 ESP32 core 2.x 里由后台任务驱动，不用手动喂）
    if (udpRunning) {
        int size = udp.parsePacket();
        if (size > 0) {
            char buf[64];
            int n = udp.read(buf, sizeof(buf) - 1);
            if (n > 0) {
                buf[n] = 0;
                if (!strcmp(buf, NET_PROBE)) {
                    String ip = netIP();
                    udp.beginPacket(udp.remoteIP(), udp.remotePort());
                    udp.print(ip);
                    udp.endPacket();
                    Serial.printf("[NET] 回应探测 %s\n", ip.c_str());
                }
            }
        }
    }

    if (!serverRunning) return;
    WiFiClient client = server.available();
    if (!client) return;

    String method, path;
    uint32_t contentLength = 0;
    if (!readRequest(client, method, path, contentLength)) {
        client.stop();
        return;
    }

    Serial.printf("[NET] %s %s (len=%u)\n", method.c_str(), path.c_str(), (unsigned)contentLength);

    if (method == "GET" && path == "/info") {
        String body = "{\"ip\":\"" + netIP() + "\",\"ssid\":\"" + netSSID() + "\"}";
        sendResponse(client, 200, "OK", body.c_str());
        return;
    }

    if (method == "GET" && path == "/ping") {
        sendResponse(client, 200, "OK", "{\"pong\":1}");
        return;
    }

    if (method == "POST" && path.startsWith("/frame")) {
        uint32_t crc = 0;
        int q = path.indexOf("crc=");
        if (q >= 0) crc = (uint32_t)strtoul(path.substring(q + 4).c_str(), nullptr, 10);
        static uint8_t body[40000];
        if (contentLength == 0 || contentLength > sizeof(body)) {
            sendResponse(client, 400, "Bad Request", "{\"error\":\"bad length\"}");
            return;
        }
        // 收满 body
        uint32_t got = 0;
        uint32_t t0 = millis();
        while (got < contentLength && millis() - t0 < 20000) {
            size_t avail = client.available();
            if (avail) {
                size_t n = avail;
                if (n > contentLength - got) n = contentLength - got;
                int r = client.read(body + got, n);
                if (r > 0) got += (uint32_t)r;
            } else {
                delay(2);
            }
        }
        if (got != contentLength) {
            sendResponse(client, 400, "Bad Request", "{\"error\":\"short body\"}");
            return;
        }
        netOnFrame(body, got, crc);
        sendResponse(client, 200, "OK", "{\"ok\":1}");
        return;
    }

    // 注意用 startsWith：path 带查询串（/show?crc=…），精确匹配会 404
    if (method == "POST" && path.startsWith("/show")) {
        // crc 从查询串里取：/show?crc=123
        uint32_t crc = 0;
        int q = path.indexOf("crc=");
        if (q >= 0) crc = (uint32_t)strtoul(path.substring(q + 4).c_str(), nullptr, 10);
        sendResponse(client, 200, "OK", "{\"ok\":1}");
        netOnShow(crc);
        return;
    }

    sendResponse(client, 404, "Not Found", "{\"error\":\"not found\"}");
}

// 墨签 InkPad · 4.2 寸三色墨水屏固件
//
// 通路：USB CDC 串口（主） / WiFi HTTP（副，M6 启用）
// 协议：ASCII 命令行 + 二进制帧，全部以 \n 结尾
//
//   PING                    → PONG <ver>
//   INFO                    → INFO w= h= bpp= cal= drv= mode= crc= fw=
//   FRAME <len> <crc32>     → READY  然后发 <len> 字节裸数据 → OK / ERR crc
//   SHOW [crc32]            → SKIP  或  SHOWING… DONE <ms>
//   TEST                    → 四段测试图 → DONE <ms>
//   CAL <0-3>               → OK（bit0 反 B 平面，bit1 反 R 平面）
//   DRV <ssd1619|ssd1683|uc8276> → OK
//   MODE <usb|wifi>         → OK / ERR wifi-disabled
//   CFG <ssid> <pass>       → OK / ERR wifi-disabled
//   BLANK                   → 清成白屏 → DONE <ms>
//   RESET                   → 重启

#include <Arduino.h>
#include <Preferences.h>
#include "epd.h"
#ifdef ENABLE_WIFI
#include <WiFi.h>
#include "net.h"
#endif

#define FW_VER "1.0.0"
#define LINE_MAX 160

static Preferences prefs;
static uint8_t frameBuf[EPD_COLOR_LEN];   // 30000 字节 2bpp

struct Config {
    uint8_t  cal;
    uint8_t  driver;
    uint8_t  mode;        // 0 = usb, 1 = wifi, 2 = SoftAP
    uint32_t lastCrc;
    char     ssid[33];
    char     pass[65];
    char     apSsid[33];  // 热点凭据持久化：固定下来电脑配一次 profile 长期有效，
    char     apPass[65];  // 否则每次重启随机换名，用户得重新看串口抓凭据
};
static Config cfg;

// ── 接收状态机 ─────────────────────────────────────────────
enum RxState { RX_LINE, RX_BINARY };
static RxState  rxState   = RX_LINE;
static char     lineBuf[LINE_MAX];
static size_t   lineLen   = 0;
static size_t   needBytes = 0;
static size_t   gotBytes  = 0;
static size_t   ackedBytes = 0;
static uint32_t expectCrc = 0;
static uint32_t lastByteMs = 0;
static uint32_t frameCrc = 0;   // 当前已就绪帧的 CRC

// 接收中断后的自愈时间：超过这么久没新字节就放弃这一帧回到命令行模式，
// 否则一次断流会让设备永远卡在 RX_BINARY，之后所有命令都被当成帧数据吞掉。
#define RX_ABORT_MS 3000

// 分块确认：每收满这么多字节回一个 ACK，主机才发下一块。
// 不这么做的话，30000 字节一口气灌进来会在 USB 层丢数据
// （实测主机以为发完了，设备只收到 17~22KB）。
#define RX_ACK_CHUNK 1024

// ── CRC32（与 zlib / Node 的 crc32 一致）───────────────────
static uint32_t crc32Of(const uint8_t *data, size_t len) {
    static uint32_t table[256];
    static bool inited = false;
    if (!inited) {
        for (uint32_t i = 0; i < 256; i++) {
            uint32_t c = i;
            for (int k = 0; k < 8; k++)
                c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
            table[i] = c;
        }
        inited = true;
    }
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < len; i++)
        c = table[(c ^ data[i]) & 0xFF] ^ (c >> 8);
    return c ^ 0xFFFFFFFFu;
}

// ── 配置持久化 ─────────────────────────────────────────────
static uint8_t defaultCalFor(uint8_t drv) {
    // SSD1619 这块屏实测：B 直发 + R 取反
    // 其他驱动沿用测试固件的默认（都不取反），首次用需校准
    return (drv == EPD_DRV_SSD1619) ? 0x02 : 0x00;
}

static void loadConfig() {
    prefs.begin("inkpad", false);
    cfg.driver  = prefs.getUChar("drv", EPD_DRV_SSD1619);
    if (cfg.driver >= EPD_DRV_COUNT) cfg.driver = EPD_DRV_SSD1619;
    cfg.cal     = prefs.getUChar("cal", defaultCalFor(cfg.driver));
    cfg.mode    = prefs.getUChar("mode", 0);
    cfg.lastCrc = prefs.getULong("crc", 0);
    // 必须先判断 key 是否存在：nvs_get_str 找不到 key 会打一行不带换行的错误日志，
    // 把紧随其后的串口回复粘在同一行，上位机的按行解析就会失败。
    if (prefs.isKey("ssid")) prefs.getString("ssid", cfg.ssid, sizeof(cfg.ssid));
    if (prefs.isKey("pass")) prefs.getString("pass", cfg.pass, sizeof(cfg.pass));
    if (prefs.isKey("apssid")) prefs.getString("apssid", cfg.apSsid, sizeof(cfg.apSsid));
    if (prefs.isKey("appass")) prefs.getString("appass", cfg.apPass, sizeof(cfg.apPass));
}

static void saveConfig() {
    prefs.putUChar("drv", cfg.driver);
    prefs.putUChar("cal", cfg.cal);
    prefs.putUChar("mode", cfg.mode);
    prefs.putULong("crc", cfg.lastCrc);
    prefs.putString("ssid", cfg.ssid);
    prefs.putString("pass", cfg.pass);
}

// ── SoftAP 启动（MODE ap 命令和开机自启共用）────────────────
// 没有保存过凭据才随机生成，生成后存 NVS——热点名固定下来，
// 电脑的 WiFi profile 配一次就长期有效
static void startAPMode() {
    if (!cfg.apSsid[0]) {
        snprintf(cfg.apSsid, sizeof(cfg.apSsid), "inkpad-%04X", (unsigned)(esp_random() & 0xFFFF));
        snprintf(cfg.apPass, sizeof(cfg.apPass), "inkpad%04d", (int)(esp_random() % 10000));
        prefs.putString("apssid", cfg.apSsid);
        prefs.putString("appass", cfg.apPass);
    }
    netInit();
    if (netStartAP(cfg.apSsid, cfg.apPass)) {
        Serial.printf("[NET] SoftAP %s / %s\n", cfg.apSsid, cfg.apPass);
    } else {
        Serial.println("[NET] SoftAP 启动失败");
    }
}

// ── 刷屏（带耗时回报）───────────────────────────────────────
static void doDisplay(const char *why) {
    Serial.print("SHOWING\n");
    Serial.flush();
    uint32_t t0 = millis();
    epdDisplay();
    Serial.printf("DONE %lu\n", (unsigned long)(millis() - t0));
    Serial.flush();
    Serial.printf("[SHOW] %s\n", why);
}

// ── 命令处理 ───────────────────────────────────────────────
// 把 "ssid|pass" 拆成两段。SSID 里可能有空格，所以用 '|' 而不是空格分隔。
static bool splitPair(const char *s, char *a, size_t aLen, char *b, size_t bLen) {
    if (!s || !*s) return false;
    const char *bar = strchr(s, '|');
    if (bar) {
        size_t n = (size_t)(bar - s);
        if (n >= aLen) n = aLen - 1;
        memcpy(a, s, n);
        a[n] = 0;
        strncpy(b, bar + 1, bLen - 1);
        b[bLen - 1] = 0;
    } else {
        strncpy(a, s, aLen - 1);
        a[aLen - 1] = 0;
        b[0] = 0;
    }
    return a[0] != 0;
}

static bool parseU32(const char *s, uint32_t *out) {
    if (!s || !*s) return false;
    char *end = nullptr;
    unsigned long v = strtoul(s, &end, 10);
    if (end == s) return false;
    *out = (uint32_t)v;
    return true;
}

static void handleFrame(const char *argLen, const char *argCrc) {
    uint32_t len = 0, crc = 0;
    if (!parseU32(argLen, &len) || !parseU32(argCrc, &crc)) {
        Serial.println("ERR args");
        return;
    }
    if (len != EPD_COLOR_LEN) {
        Serial.printf("ERR len want=%d\n", EPD_COLOR_LEN);
        return;
    }
    needBytes = len;
    gotBytes  = 0;
    ackedBytes = 0;
    expectCrc = crc;
    lastByteMs = millis();
    rxState   = RX_BINARY;
    Serial.println("READY");
    Serial.flush();
}

static void handleLine(char *line) {
    // 先补一个换行：ESP-IDF 有些日志（如 spiAttachMISO）不带换行，
    // 会把紧随其后的回复粘在同一行，上位机按行解析就会漏掉。见 selftest 注释。
    Serial.print("\r\n");

    // 去掉行尾 \r
    size_t n = strlen(line);
    while (n && (line[n - 1] == '\r' || line[n - 1] == ' ')) line[--n] = 0;

    char *cmd  = strtok(line, " ");
    if (!cmd) return;
    // 先取剩余整段（不按空格切）。带空格的 SSID 用这个，配合 '|' 分隔。
    // 顺序很重要：strtok 有状态，必须先拿整段再从里面切 a1/a2。
    char *rest = strtok(nullptr, "");
    char *a1   = rest ? strtok(rest, " ") : nullptr;
    char *a2   = strtok(nullptr, " ");

    for (char *p = cmd; *p; p++) *p = toupper((unsigned char)*p);

    if (!strcmp(cmd, "PING")) {
        Serial.printf("PONG %s\n", FW_VER);

    } else if (!strcmp(cmd, "INFO")) {
        Serial.printf("INFO w=%d h=%d bpp=2 cal=%u drv=%s mode=%s crc=%lu fw=%s\n",
                      EPD_W, EPD_H, (unsigned)epdGetCal(), epdDriverName(),
                      cfg.mode ? "wifi" : "usb",
                      (unsigned long)cfg.lastCrc, FW_VER);

    } else if (!strcmp(cmd, "FRAME")) {
        handleFrame(a1, a2);

    } else if (!strcmp(cmd, "SHOW")) {
        uint32_t crc = 0;
        if (parseU32(a1, &crc) && crc == cfg.lastCrc && cfg.lastCrc != 0) {
            Serial.println("SKIP");
            return;
        }
        doDisplay("usb");
        if (crc) { cfg.lastCrc = crc; prefs.putULong("crc", crc); }

    } else if (!strcmp(cmd, "TEST")) {
        epdBuildTestPattern(cfg.driver);
        doDisplay("test-pattern");

    } else if (!strcmp(cmd, "CAL")) {
        uint32_t v = 0;
        if (!parseU32(a1, &v) || v > 3) { Serial.println("ERR args"); return; }
        cfg.cal = (uint8_t)v;
        epdSetCal(cfg.cal);
        prefs.putUChar("cal", cfg.cal);
        Serial.printf("OK cal=%u\n", (unsigned)cfg.cal);

    } else if (!strcmp(cmd, "DRV")) {
        if (!a1) { Serial.println("ERR args"); return; }
        int found = -1;
        for (int i = 0; i < EPD_DRV_COUNT; i++)
            if (!strcasecmp(a1, epdDriverNameOf((uint8_t)i))) found = i;
        if (found < 0) { Serial.println("ERR args"); return; }
        cfg.driver = (uint8_t)found;
        cfg.cal    = defaultCalFor(cfg.driver);
        epdSetDriver(cfg.driver);
        epdSetCal(cfg.cal);
        saveConfig();
        Serial.printf("OK drv=%s cal=%u\n", epdDriverName(), (unsigned)cfg.cal);

    } else if (!strcmp(cmd, "MODE")) {
#ifdef ENABLE_WIFI
        if (!a1) { Serial.println("ERR args"); return; }
        if (!strcasecmp(a1, "ap")) {
            cfg.mode = 2;
            prefs.putUChar("mode", cfg.mode);
            startAPMode();
            Serial.printf("AP OK %s %s\n", cfg.apSsid, cfg.apPass);
            Serial.println("OK mode=ap");
        } else if (!strcasecmp(a1, "wifi")) {
            cfg.mode = 1;
            prefs.putUChar("mode", cfg.mode);
            Serial.println("OK mode=wifi");
            Serial.flush();
            // 用 NVS 里存的账号连上，然后开 HTTP 服务
            netInit();
            if (netConnect(cfg.ssid, cfg.pass, 20000)) {
                netStartServer();
                Serial.printf("[NET] IP=%s  名称=%s.local\n",
                              netIP().c_str(), NET_MDNS_NAME);
            } else {
                Serial.println("[NET] 连接失败");
            }
        } else {
            cfg.mode = 0;
            prefs.putUChar("mode", cfg.mode);
            netStopServer();
            Serial.println("OK mode=usb");
        }
#else
        Serial.println("ERR wifi-disabled");
#endif

    } else if (!strcmp(cmd, "SCAN")) {
#ifdef ENABLE_WIFI
        netInit();
        int n = netScan();
        for (int i = 0; i < n; i++) {
            Serial.printf("SSID %s %d\n", netScanSSID(i), netScanRSSI(i));
        }
        Serial.printf("SCANDONE %d\n", n);
#else
        Serial.println("ERR wifi-disabled");
#endif

    } else if (!strcmp(cmd, "WIFI")) {
#ifdef ENABLE_WIFI
        char ssid[33] = {0}, pass[65] = {0};
        if (!splitPair(rest, ssid, sizeof(ssid), pass, sizeof(pass))) {
            Serial.println("ERR args"); return;
        }
        netInit();
        if (netConnect(ssid, pass, 20000)) {
            netStartServer();
            Serial.printf("WIFI OK %s\n", netIP().c_str());
        } else {
            Serial.println("WIFI ERR");
        }
#else
        Serial.println("ERR wifi-disabled");
#endif

    } else if (!strcmp(cmd, "AP")) {
#ifdef ENABLE_WIFI
        char ssid[33] = {0}, pass[65] = {0};
        if (!splitPair(rest, ssid, sizeof(ssid), pass, sizeof(pass))) {
            Serial.println("ERR args"); return;
        }
        if (netStartAP(ssid, pass)) {
            cfg.mode = 2;   // 2 = SoftAP 模式
            prefs.putUChar("mode", 2);
            // 手动指定的凭据也存下来，重启后热点不变
            strncpy(cfg.apSsid, ssid, sizeof(cfg.apSsid) - 1);
            strncpy(cfg.apPass, pass, sizeof(cfg.apPass) - 1);
            prefs.putString("apssid", cfg.apSsid);
            prefs.putString("appass", cfg.apPass);
            Serial.printf("AP OK %s %s\n", ssid, WiFi.softAPIP().toString().c_str());
        } else {
            Serial.println("AP ERR");
        }
#else
        Serial.println("ERR wifi-disabled");
#endif

    } else if (!strcmp(cmd, "WIFIINFO")) {
#ifdef ENABLE_WIFI
        Serial.printf("WIFIINFO %d %s %s\n", netConnected() ? 1 : 0,
                      netIP().c_str(), netSSID().c_str());
#else
        Serial.println("ERR wifi-disabled");
#endif

    } else if (!strcmp(cmd, "CFG")) {
#ifdef ENABLE_WIFI
        char ssid[33] = {0}, pass[65] = {0};
        if (!splitPair(rest, ssid, sizeof(ssid), pass, sizeof(pass))) {
            Serial.println("ERR args"); return;
        }
        strncpy(cfg.ssid, ssid, sizeof(cfg.ssid) - 1);
        strncpy(cfg.pass, pass, sizeof(cfg.pass) - 1);
        saveConfig();
        Serial.println("OK");
#else
        Serial.println("ERR wifi-disabled");
#endif

    } else if (!strcmp(cmd, "BLANK")) {
        epdFillAllWhite();
        doDisplay("blank");

    } else if (!strcmp(cmd, "RESET")) {
        Serial.println("OK rebooting");
        Serial.flush();
        delay(100);
        ESP.restart();

    } else {
        Serial.printf("ERR unknown %s\n", cmd);
    }
    Serial.flush();
}

// 收到一整帧后的统一处理：串口和 HTTP 两条路都走这里
static void acceptFrame(const uint8_t *data, size_t len, uint32_t expectCrc) {
    if (len != EPD_COLOR_LEN) {
        Serial.printf("[RX] 长度不对 %u\n", (unsigned)len);
        return;
    }
    uint32_t crc = crc32Of(data, len);
    if (expectCrc && crc != expectCrc) {
        Serial.printf("[RX] crc 不符 got=%lu want=%lu\n",
                      (unsigned long)crc, (unsigned long)expectCrc);
        return;
    }
    memcpy(frameBuf, data, EPD_COLOR_LEN);
    frameCrc = crc;
    Serial.printf("[RX] 帧已就绪 crc=%lu\n", (unsigned long)crc);
}

// ── 二进制帧接收 ───────────────────────────────────────────
static void pumpBinary() {
    // 一口气把可读的都读走：帧是 30000 字节的连续突发，
    // 中间插 delay 会喂不饱，接收缓冲一溢出就永远凑不满 needBytes。
    while (gotBytes < needBytes) {
        size_t avail = Serial.available();
        if (!avail) {
            // 断流自愈：超时没新字节就放弃这一帧，回到命令行模式
            if (millis() - lastByteMs > RX_ABORT_MS) {
                Serial.printf("\r\nERR timeout %u/%u\r\n",
                              (unsigned)gotBytes, (unsigned)needBytes);
                Serial.flush();
                gotBytes = 0;
                rxState = RX_LINE;
                lineLen = 0;
            }
            return;
        }
        size_t want = needBytes - gotBytes;
        if (avail > want) avail = want;
        int r = Serial.read(frameBuf + gotBytes, avail);
        if (r <= 0) return;
        gotBytes += (size_t)r;
        lastByteMs = millis();

        // 每收满一块就回一个 ACK，主机收到才继续发下一块。
        // 最后一块（不足 1024）也要 ACK，主机才知道整帧到齐了。
        if (gotBytes == needBytes || gotBytes >= ackedBytes + RX_ACK_CHUNK) {
            ackedBytes = gotBytes;
            Serial.printf("ACK %u\n", (unsigned)ackedBytes);
        }
    }

    uint32_t crc = crc32Of(frameBuf, needBytes);
    Serial.print("\r\n");
    if (crc != expectCrc) {
        Serial.printf("ERR crc got=%lu want=%lu\n",
                      (unsigned long)crc, (unsigned long)expectCrc);
    } else {
        epdFrom2bpp(frameBuf, needBytes);
        Serial.println("OK");
    }
    Serial.flush();
    rxState = RX_LINE;
}

// ── 行接收 ─────────────────────────────────────────────────
static void pumpLine() {
    while (Serial.available()) {
        char c = (char)Serial.read();
        if (c == '\n') {
            lineBuf[lineLen] = 0;
            if (lineLen) handleLine(lineBuf);
            lineLen = 0;
            // handleLine 可能把状态切到 RX_BINARY
            if (rxState == RX_BINARY) return;
        } else if (c != '\r') {
            if (lineLen < LINE_MAX - 1) lineBuf[lineLen++] = c;
            else lineLen = 0;   // 超长行丢弃，防止卡死
        }
    }
}

// ── WiFi 副通路（HTTP 侧回调）───────────────────────────────
#ifdef ENABLE_WIFI
void netOnFrame(uint8_t *data, size_t len, uint32_t crc) {
    acceptFrame(data, len, crc);
}

void netOnShow(uint32_t crc) {
    bool wasAP = netInAP();

    // crc 对不上说明帧没收到（frameBuf 里是旧帧），不能刷
    if (crc && frameCrc && crc != frameCrc) {
        Serial.println("[NET] crc 不匹配，跳过");
        return;
    }
    // 和上次刷的相同，跳过（对齐 USB 通路的 SKIP 语义，省 13.7 秒）
    if (crc && crc == cfg.lastCrc && cfg.lastCrc != 0) {
        Serial.println("[NET] 与上次相同，跳过");
        return;
    }

    // HTTP 响应已经发出去了，这里可以放心断射频刷屏。
    // 墨水屏刷新时 WiFi 射频会干扰波形，所以刷之前关掉，刷完再连。
    delay(300);
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    netStopServer();   // 射频下线，HTTP/UDP/mDNS 一起停，重连后重建
    delay(300);

    doDisplay("wifi");
    cfg.lastCrc = crc ? crc : frameCrc;
    prefs.putULong("crc", cfg.lastCrc);

    // 按原来的模式恢复：热点模式重开同一个热点，STA 模式重连路由器。
    // 不区分的话热点模式刷一次屏就会退回 STA，WiFi 通路从此失灵
    if (wasAP) {
        if (netRestartAP()) Serial.println("[NET] 热点已恢复");
        else Serial.println("[NET] 热点恢复失败");
    } else {
        netInit();
        if (netConnect(cfg.ssid, cfg.pass, 20000)) netStartServer();
        else Serial.println("[NET] 重连失败，可用 USB 通路或重启设备");
    }
}
#endif

// ── 入口 ───────────────────────────────────────────────────
void setup() {
    // 必须在 begin() 之前设置。默认 256 字节，装不下 30000 字节的帧突发。
    Serial.setRxBufferSize(8192);
    Serial.begin(115200);
    delay(300);

    loadConfig();
    epdSetDriver(cfg.driver);
    epdSetCal(cfg.cal);
    epdInit();

    Serial.printf("\nBOOT inkpad %s drv=%s cal=%u mode=%s\n",
                  FW_VER, epdDriverName(), (unsigned)cfg.cal,
                  cfg.mode ? "wifi" : "usb");
    Serial.println("READY-INKPAD");
    Serial.flush();

#ifdef ENABLE_WIFI
    netInit();
    if (cfg.mode == 2) {
        startAPMode();
    } else if (cfg.mode == 1 && cfg.ssid[0]) {
        if (netConnect(cfg.ssid, cfg.pass, 20000)) {
            netStartServer();
            Serial.printf("[NET] IP=%s  名称=%s.local\n", netIP().c_str(), NET_MDNS_NAME);
        }
    }
#endif
}

void loop() {
#ifdef ENABLE_WIFI
    if (cfg.mode == 1 || cfg.mode == 2) netLoop();
#endif
    if (rxState == RX_BINARY) {
        pumpBinary();   // 不收尾不加延时，尽量吃满带宽
    } else {
        pumpLine();
        delay(1);
    }
}

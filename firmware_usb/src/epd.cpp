// 电子纸驱动实现
//
// ⚠ 所有命令序列、延时、BUSY 电平判断均照抄 epd42_test/src/main.cpp，
//   那份是四段测试图实测全对的版本。改这里之前先回去看测试固件。

#include "epd.h"
#include <Arduino.h>
#include <SPI.h>

// ── 引脚（与 InkSight ESP32-C3 配置一致，改接线同步改这里）──
#ifndef PIN_EPD_MOSI
#define PIN_EPD_MOSI 6
#endif
#ifndef PIN_EPD_SCK
#define PIN_EPD_SCK 4
#endif
#ifndef PIN_EPD_CS
#define PIN_EPD_CS 7
#endif
#ifndef PIN_EPD_DC
#define PIN_EPD_DC 1
#endif
#ifndef PIN_EPD_RST
#define PIN_EPD_RST 2
#endif
#ifndef PIN_EPD_BUSY
#define PIN_EPD_BUSY 10
#endif
#ifndef EPD_SPI_HZ
#define EPD_SPI_HZ 8000000
#endif
// 占位 MISO：本屏只写不读，但 SPI.begin() 传 -1 会触发 IDF 错误日志
#ifndef PIN_EPD_MISO_DUMMY
#define PIN_EPD_MISO_DUMMY 5
#endif

static uint8_t bwPlane[EPD_FRAME_LEN];  // bit=1 白, bit=0 黑
static uint8_t rdPlane[EPD_FRAME_LEN];  // bit=1 无红, bit=0 红

static uint8_t s_driver = EPD_DRV_SSD1619;
static uint8_t s_cal    = 0x02;  // B 直发 + R 取反（测试固件默认，实测正确）

static const char *kDriverNames[EPD_DRV_COUNT] = {
    "ssd1619",   // Solum 价签
    "ssd1683",   // GDEY042Z98
    "uc8276",    // GDEQ042Z21 / 微雪 V2
};

// 测试图上画的驱动代号。沿用 epd42_test 老文档的 a/b/c 命名，
// 免得和以前的排查记录对不上（老固件里 SSD1619 就是 B）。
static const char kDriverLetters[EPD_DRV_COUNT] = {'B', 'C', 'A'};

// ── 底层 SPI ────────────────────────────────────────────────
static void epdCmd(uint8_t c) {
    digitalWrite(PIN_EPD_CS, LOW);
    digitalWrite(PIN_EPD_DC, LOW);
    SPI.transfer(c);
    digitalWrite(PIN_EPD_CS, HIGH);
}
static void epdDataByte(uint8_t d) {
    digitalWrite(PIN_EPD_CS, LOW);
    digitalWrite(PIN_EPD_DC, HIGH);
    SPI.transfer(d);
    digitalWrite(PIN_EPD_CS, HIGH);
}
static void epdDataBuf(const uint8_t *buf, size_t len) {
    digitalWrite(PIN_EPD_CS, LOW);
    digitalWrite(PIN_EPD_DC, HIGH);
    SPI.transferBytes(buf, nullptr, len);
    digitalWrite(PIN_EPD_CS, HIGH);
}
static void epdReset() {
    digitalWrite(PIN_EPD_RST, LOW);  delay(2);
    digitalWrite(PIN_EPD_RST, HIGH); delay(10);
    digitalWrite(PIN_EPD_RST, LOW);  delay(2);
    digitalWrite(PIN_EPD_RST, HIGH); delay(10);
}

// busyLevel：忙时 BUSY 引脚的电平。返回是否在超时内变闲。
static bool waitBusy(int busyLevel, const char *tag, uint32_t timeoutMs = 20000) {
    uint32_t t0 = millis();
    int prev = digitalRead(PIN_EPD_BUSY);
    while (millis() - t0 < timeoutMs) {
        int v = digitalRead(PIN_EPD_BUSY);
        if (v != prev) prev = v;
        if (v != busyLevel) return true;
        delay(2);
    }
    Serial.printf("[EPD] %s BUSY 超时 %lu ms\n", tag, (unsigned long)timeoutMs);
    return false;
}

// ── UC8276 ─────────────────────────────────────────────────
static void initUC8276() {
    epdReset();
    epdCmd(0x00); epdDataByte(0x0f);   // panel setting, LUT from OTP
}
static void powerOnUC8276() {
    epdCmd(0x04); waitBusy(LOW, "UC8276 PowerOn", 5000);
}
static void refreshUC8276() {
    epdCmd(0x12); waitBusy(LOW, "UC8276 Refresh", 30000);
}
static void powerOffUC8276() {
    epdCmd(0x02); waitBusy(LOW, "UC8276 PowerOff", 5000);
}

// ── SSD1619 ────────────────────────────────────────────────
static void initSSD1619() {
    epdReset();
    delay(10);
    epdCmd(0x74); epdDataByte(0x54);                     // analog block
    epdCmd(0x7E); epdDataByte(0x3B);                     // digital block
    epdCmd(0x2B); epdDataByte(0x04); epdDataByte(0x63);
    epdCmd(0x0C);                                        // soft start
    epdDataByte(0x8f); epdDataByte(0x8f); epdDataByte(0x8f); epdDataByte(0x3f);
    epdCmd(0x01);                                        // driver output control
    epdDataByte((EPD_H - 1) & 0xFF);
    epdDataByte((EPD_H - 1) >> 8);
    epdDataByte(0x00);
    epdCmd(0x3C); epdDataByte(0x01);                     // border waveform
    epdCmd(0x18); epdDataByte(0x80);                     // 载入内部温度
    // ⚠ 不要写 0x1A 覆盖温度 —— 实测会切换 LUT，同一份数据映射出不同颜色
    epdCmd(0x21); epdDataByte(0x00);                     // 输出模式锁定
    epdCmd(0x11); epdDataByte(0x03);                     // 数据入口 X+ Y+
    epdCmd(0x44); epdDataByte(0x00); epdDataByte((EPD_W - 1) / 8);
    epdCmd(0x45); epdDataByte(0x00); epdDataByte(0x00);
    epdDataByte((EPD_H - 1) & 0xFF); epdDataByte((EPD_H - 1) >> 8);
    epdCmd(0x22); epdDataByte(0xB1);                     // 载入默认 LUT
    epdCmd(0x20);                                        // master activation
    waitBusy(HIGH, "SSD1619 InitPower", 5000);
}
static void refreshSSD1619() {
    epdCmd(0x22); epdDataByte(0xC7);
    epdCmd(0x20);
    waitBusy(HIGH, "SSD1619 Refresh", 30000);
}
static void powerOffSSD1619() {
    epdCmd(0x22); epdDataByte(0x03);
    epdCmd(0x20);
    // 这里不等 BUSY：断电后这块屏的 BUSY 会一直挂在忙电平，等也是白等 5 秒。
    // 刷新阶段的 BUSY 已经在 refreshSSD1619() 里等过了，断电只是收尾。
    delay(200);
}

// ── SSD1683 ────────────────────────────────────────────────
static void initSSD1683() {
    epdReset();
    epdCmd(0x12);                                        // SWRESET
    delay(10);
    epdCmd(0x01);
    epdDataByte((EPD_H - 1) % 256);
    epdDataByte((EPD_H - 1) / 256);
    epdDataByte(0x00);
    epdCmd(0x3C); epdDataByte(0x05);
    epdCmd(0x18); epdDataByte(0x80);
    epdCmd(0x11); epdDataByte(0x03);
    epdCmd(0x44); epdDataByte(0x00); epdDataByte((EPD_W - 1) / 8);
    epdCmd(0x45); epdDataByte(0x00); epdDataByte(0x00);
    epdDataByte((EPD_H - 1) & 0xFF); epdDataByte((EPD_H - 1) >> 8);
    epdCmd(0x4E); epdDataByte(0x00);
    epdCmd(0x4F); epdDataByte(0x00); epdDataByte(0x00);
}
static void powerOnSSD1683() {
    epdCmd(0x22); epdDataByte(0xC0);
    epdCmd(0x20);
    waitBusy(HIGH, "SSD1683 PowerOn", 5000);
}
static void refreshSSD1683() {
    epdCmd(0x22); epdDataByte(0xF7);
    epdCmd(0x20);
    waitBusy(HIGH, "SSD1683 Refresh", 30000);
}
static void powerOffSSD1683() {
    epdCmd(0x22); epdDataByte(0xC3);
    epdCmd(0x20);
    waitBusy(HIGH, "SSD1683 PowerOff", 5000);
}

// ── 平面发送（可选取反）─────────────────────────────────────
// 分块处理，避免额外 15KB 临时缓冲
static void sendPlane(const uint8_t *src, bool invert) {
    if (!invert) {
        epdDataBuf(src, EPD_FRAME_LEN);
        return;
    }
    static uint8_t chunk[512];
    size_t off = 0;
    while (off < (size_t)EPD_FRAME_LEN) {
        size_t n = EPD_FRAME_LEN - off;
        if (n > sizeof(chunk)) n = sizeof(chunk);
        for (size_t i = 0; i < n; i++) chunk[i] = (uint8_t)~src[off + i];
        epdDataBuf(chunk, n);
        off += n;
    }
}

// ── 对外接口 ───────────────────────────────────────────────
void epdInit() {
    pinMode(PIN_EPD_CS, OUTPUT);
    pinMode(PIN_EPD_DC, OUTPUT);
    pinMode(PIN_EPD_RST, OUTPUT);
    pinMode(PIN_EPD_BUSY, INPUT);
    digitalWrite(PIN_EPD_CS, HIGH);
    digitalWrite(PIN_EPD_DC, LOW);
    digitalWrite(PIN_EPD_RST, HIGH);
    // MISO 传 -1 会让 ESP-IDF 打一行不带换行的错误日志，粘住后面的串口回复。
    // 这里给一个不接线、永不读取的占位脚，只为消掉那条日志。
    SPI.begin(PIN_EPD_SCK, PIN_EPD_MISO_DUMMY, PIN_EPD_MOSI);
    SPI.beginTransaction(SPISettings(EPD_SPI_HZ, MSBFIRST, SPI_MODE0));
    epdFillAllWhite();
}

void epdSetDriver(uint8_t drv) {
    if (drv < EPD_DRV_COUNT) s_driver = drv;
}
uint8_t epdGetDriver() { return s_driver; }
const char *epdDriverName() { return kDriverNames[s_driver]; }
const char *epdDriverNameOf(uint8_t drv) {
    return (drv < EPD_DRV_COUNT) ? kDriverNames[drv] : "";
}

void epdSetCal(uint8_t cal) { s_cal = cal & 0x03; }
uint8_t epdGetCal() { return s_cal; }

void epdFrom2bpp(const uint8_t *src, size_t len) {
    if (len < (size_t)EPD_COLOR_LEN) return;
    memset(bwPlane, 0x00, EPD_FRAME_LEN);   // 默认黑=0
    memset(rdPlane, 0xFF, EPD_FRAME_LEN);   // 默认无红
    int ob = 0, ot = 0;
    for (int i = 0; i < EPD_COLOR_LEN; i++) {
        uint8_t s = src[i];
        for (int k = 0; k < 4; k++) {
            uint8_t code = (s >> (6 - k * 2)) & 0x03;
            if (code != 0) bwPlane[ob] |= (0x80 >> ot);              // 白/红/黄 = 1
            if (code == 2 || code == 3) rdPlane[ob] &= ~(0x80 >> ot); // 黄/红 = 0
            if (++ot == 8) { ot = 0; ob++; }
        }
    }
}

void epdFillAllWhite() {
    memset(bwPlane, 0xFF, EPD_FRAME_LEN);
    memset(rdPlane, 0xFF, EPD_FRAME_LEN);
}
void epdFillAllBlack() {
    memset(bwPlane, 0x00, EPD_FRAME_LEN);
    memset(rdPlane, 0xFF, EPD_FRAME_LEN);
}
void epdFillAllRed() {
    memset(bwPlane, 0xFF, EPD_FRAME_LEN);
    memset(rdPlane, 0x00, EPD_FRAME_LEN);
}

static void fillRect(int x, int y, int w, int h, bool black, bool red) {
    for (int j = y; j < y + h && j < EPD_H; j++) {
        if (j < 0) continue;
        for (int i = x; i < x + w && i < EPD_W; i++) {
            if (i < 0) continue;
            int bit = 7 - (i & 7);
            int idx = (j * EPD_ROW_BYTES) + (i >> 3);
            if (black) bwPlane[idx] &= ~(1 << bit); else bwPlane[idx] |= (1 << bit);
            if (red)   rdPlane[idx] &= ~(1 << bit); else rdPlane[idx] |= (1 << bit);
        }
    }
}

// 3x5 方块字，画 A/B/C 标记当前驱动
static void drawLetterBig(char c, int x, int y, int s) {
    switch (c) {
        case 'A':
            fillRect(x, y, 3 * s, s, true, false);
            fillRect(x, y, s, 5 * s, true, false);
            fillRect(x + 2 * s, y, s, 5 * s, true, false);
            fillRect(x, y + 2 * s, 3 * s, s, true, false);
            break;
        case 'B':
            fillRect(x, y, s, 5 * s, true, false);
            fillRect(x + s, y, 2 * s, s, true, false);
            fillRect(x + 2 * s, y + s, s, s, true, false);
            fillRect(x + s, y + 2 * s, 2 * s, s, true, false);
            fillRect(x + 2 * s, y + 3 * s, s, s, true, false);
            fillRect(x + s, y + 4 * s, 2 * s, s, true, false);
            break;
        case 'C':
            fillRect(x + s, y, 2 * s, s, true, false);
            fillRect(x, y + s, s, 3 * s, true, false);
            fillRect(x + s, y + 4 * s, 2 * s, s, true, false);
            break;
    }
}

void epdBuildTestPattern(uint8_t driverIdx) {
    if (driverIdx >= EPD_DRV_COUNT) driverIdx = EPD_DRV_SSD1619;
    epdFillAllWhite();
    int band = EPD_H / 4;   // 75px

    // 带1 纯黑
    fillRect(0, 0, EPD_W, band, true, false);
    // 带2 纯白 + 驱动代号大字
    drawLetterBig(kDriverLetters[driverIdx], 20, band + 25, 12);
    // 带3 纯红
    fillRect(0, band * 2, EPD_W, band, false, true);
    // 带4 棋盘格：左半黑白 / 右半红白
    for (int gy = 0; gy < band; gy += 20) {
        for (int gx = 0; gx < EPD_W; gx += 20) {
            bool on = (((gx / 20) + (gy / 20)) & 1) != 0;
            if (gx < EPD_W / 2) fillRect(gx, band * 3 + gy, 20, 20, on, false);
            else                fillRect(gx, band * 3 + gy, 20, 20, false, on);
        }
    }
}

bool epdDisplay() {
    uint32_t t0 = millis();
    bool invB = (s_cal & 0x01) != 0;
    bool invR = (s_cal & 0x02) != 0;
    bool ok = true;

    switch (s_driver) {
        case EPD_DRV_UC8276:
            initUC8276();
            epdCmd(0x10); sendPlane(bwPlane, invB);
            epdCmd(0x13); sendPlane(rdPlane, invR);
            powerOnUC8276();
            refreshUC8276();
            powerOffUC8276();
            break;

        case EPD_DRV_SSD1683:
            initSSD1683();
            powerOnSSD1683();
            epdCmd(0x24); sendPlane(bwPlane, invB);
            epdCmd(0x4E); epdDataByte(0x00);
            epdCmd(0x4F); epdDataByte(0x00); epdDataByte(0x00);
            epdCmd(0x26); sendPlane(rdPlane, invR);
            refreshSSD1683();
            powerOffSSD1683();
            break;

        case EPD_DRV_SSD1619:
        default:
            initSSD1619();
            epdCmd(0x24); sendPlane(bwPlane, invB);
            epdCmd(0x4E); epdDataByte(0x00);
            epdCmd(0x4F); epdDataByte(0x00); epdDataByte(0x00);
            epdCmd(0x26); sendPlane(rdPlane, invR);
            refreshSSD1619();
            powerOffSSD1619();
            break;
    }

    Serial.printf("[EPD] %s 刷屏完成 %lu ms\n",
                  epdDriverName(), (unsigned long)(millis() - t0));
    return ok;
}

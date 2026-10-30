// 电子纸驱动层 —— 时序与命令序列照抄 epd42_test（四段测试图已验证全对）
//
// 支持三种驱动 IC，通过 epdSetDriver() 切换：
//   SSD1619  Solum 拆机价签屏（当前这块）
//   SSD1683  佳显 GDEY042Z98 快刷三色
//   UC8276   GDEQ042Z21 / 微雪 4.2B V2 / 中景园
//
// 颜色极性用 cal 位掩码控制，存 NVS，可在应用里校准：
//   bit0 = B 平面(0x24/0x10) 取反
//   bit1 = R 平面(0x26/0x13) 取反
// 默认 0b10（B 直发 + R 取反）= 测试固件的默认值 = 实测四段全对的那套。
#pragma once

#include <stdint.h>
#include <stddef.h>

#define EPD_W 400
#define EPD_H 300
#define EPD_ROW_BYTES (EPD_W / 8)
#define EPD_FRAME_LEN (EPD_ROW_BYTES * EPD_H)   // 15000 字节/平面
#define EPD_COLOR_LEN ((EPD_W * EPD_H) / 4)     // 30000 字节 2bpp

enum EpdDriverId {
    EPD_DRV_SSD1619 = 0,
    EPD_DRV_SSD1683 = 1,
    EPD_DRV_UC8276  = 2,
    EPD_DRV_COUNT   = 3
};

void        epdInit();                       // 引脚/SPI 初始化，setup 里调一次
void        epdSetDriver(uint8_t drv);
uint8_t     epdGetDriver();
const char *epdDriverName();                  // 当前驱动名
const char *epdDriverNameOf(uint8_t drv);     // 指定驱动名，越界返回 ""
void        epdSetCal(uint8_t cal);
uint8_t     epdGetCal();

// 2bpp → 双平面。调色板：0=黑 1=白 2=黄 3=红（本屏黄显示为红）
void epdFrom2bpp(const uint8_t *src, size_t len);

// 整屏纯色，用于诊断
void epdFillAllWhite();
void epdFillAllBlack();
void epdFillAllRed();

// 四段测试图：黑条 / 白底大字 / 红条 / 棋盘格
void epdBuildTestPattern(uint8_t driverIdx);

// 刷屏。返回 false 表示 BUSY 超时
bool epdDisplay();

# 更新日志（CHANGELOG）

本文件记录墨签 InkPad 每一轮发布的全部变更，只增不改（笔误修正除外）。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；版本号与 `package.json` 同步。

## [0.4.4] - 2026-10-30

修复预览偶发缺字/半字（渐进光栅化竞态）与年进度日期换行，按用户要求加强全模板红色重点。

### 修复

- **预览偶发缺字/半字（如今日历史"料"只显示一半）**：预览图原来用 `toPNG()` 截取离屏帧，而离屏渲染是渐进光栅化——首个非空白帧 ≠ 全部画完，截到中间帧就是半截字（偶发、难复现）。两层修复：① `app/render.js` 在首帧非空后再固定等 150ms 持续接收 paint 更新，让光栅化收尾后才取帧；② `app/main.js` 预览改用 `frameToPreviewPng()` 把量化帧直接上色——所见即所推，预览与上屏像素完全一致，也不再依赖 toPNG
- **年进度红色日期换行**：`.mark .d` 固定宽 56px 装不下"10月30日"折成两行；改为 `flex: 0 0 auto; white-space: nowrap` 按内容自适应，日期单行、事件名占满余下空间
- **勘误（0.4.3 排查记录）**："`out/<模板>.png` toPNG 黑底异常"实为自研诊断解码器只实现了 PNG filter 0，而 toPNG 产物用 Sub/Up filter → 解码错乱显黑底。`tools/pixcheck.js` 已补全 5 种 filter 解码，toPNG 本身无问题

### 增强（红色重点，7 模板 8 处）

- 年进度：96px 年度百分比大数字转红（hero 数字与天气温度/倒数日天数同语言）
- 待办：底栏完成度百分比数字转红
- 金句：出处转红
- 备忘录：头部日期转红（与便签红方块呼应）
- 今日历史：头部下边线改 2px 红（与日期牌/倒数日头部语言统一）
- 日读：左栏今日进度条填充转黑为红（与全局进度条填充统一）
- 相框：说明条顶边加 2px 红线（唯一无红模板，有 caption 时才显示）
- 全线红色占比 0.12%~5%，仍在设计规范 ≤5% 内；render-test 19 模板全绿、黄 0%

### 排查记录

- 新增 `tools/overflowcheck.js`：全模板自动报页面溢出/元素越界/内容裁切；19 模板仅 3 处"行盒 > 内容盒"报告（金句引号/天气温度/日历标题），经 misscheck 与量化帧确认均为 `overflow: visible` 下的正常现象，无实际裁字
- `tools/misscheck.js` 复跑：19 模板"DOM 有字但渲染空白"全部为 0

## [0.4.3] - 2026-10-30

修复日读模板电池图标消失（CSS 类名冲突），并系统排查全部模板的元素缺失。

### 修复

- **日读模板电池图标消失（真根因：类名冲突）**：模板内正文右栏的全局类 `.right { flex-direction: column }` 同样命中顶栏的 `.right`，顶栏右侧组被改成纵向——天气与电池掉成两行、顶栏撑高 24px、整版下压，电池在量化预览里与分隔线/正文挤压重叠，视觉即"缺了一边"。正文两栏改名 `.col-left`/`.col-right` 消除冲突
- **电池电量填充块不显示**：`.fill` 是 inline span，`width/height:100%` 对 inline 无效（`.shell` 作为 flex item 被块化但其子元素不会）；补 `display:block`

### 排查记录（结论：其余 18 模板无元素级缺失）

- 关键推理：threshold 量化下亮度 <170 的像素全部保留，文字核心笔画（<100）不可能被量化丢掉 → "缺失"只能是布局/渲染 bug 或数据为空
- 新增 `tools/misscheck.js`：DOM 探针拿所有有内容的元素 rect → 对照原始渲染与量化帧对应区域，"DOM 有但渲染空白 / 原始有但量化消失" 自动报告；用用户真实 data.json 跑全部 19 模板，仅日读报缺失（即上述 bug），修复后全部 OK
- 新增诊断工具：`tools/pixcheck.js`（PNG 区域灰度 ASCII）、`tools/txtcheck.js`（指定模板指定区域 原始灰度 vs 量化 1:1 对照）、`tools/usercheck.js`（真实数据全模板量化缩略目检）
- 顺带确认：`out/<模板>.png`（`toPNG()` 产物）在此环境输出黑底异常，仅调试用，不影响功能；量化预览以 `-quant.png` 为准
- 阈值扫描（t140/t170/t200）对比：大字三档均完整，粗细差 ~6%，阈值不是缺失来源

## [0.4.2] - 2026-10-30

根治关窗后进程残留：0.4.1 只修了伴生问题，真根因是离屏渲染窗拦住了 `window-all-closed`。

### 修复

- **主窗关闭后进程仍残留（真根因）**：渲染管线按设计全程复用一个离屏 `BrowserWindow`（销毁重建会硬崩，见 `app/render.js` 头注释），而它只在 `before-quit → dispose()` 里销毁；于是死锁环成立——离屏窗活着 → `window-all-closed` 永不触发 → `app.quit()` 走不到 → `dispose()` 也走不到 → 主进程成僵尸持锁。现在主窗 `closed` 时直接 `app.quit()`，由既有 `before-quit → dispose()` 链路收掉离屏窗后正常退出
- **第二实例 `gotLock=false` 后偶发不退出**：ready 前调 `app.quit()` 会被初始化流程吞掉（Electron 已知边界）；该路径未开任何资源，改为 `app.exit(0)` 立即退出

### 排查记录

- 复现方式：启动打包版 → 对主窗 `CloseMainWindow()`（等价点 X）→ 窗口销毁（`MainWindowHandle=0`）但 5 进程全存活，`app.log` 无 `window-all-closed` 痕迹 → 反推有窗口未关 → 锁定 `sharedWin`
- 注意 `taskkill /PID`（不带 /f）对 Electron 不可靠：WM_CLOSE 会误伤子进程（观察到 PID 变化），模拟点 X 要用 `(Get-Process -Id <主进程>).CloseMainWindow()`
- 开发版实测通过：单实例关窗 6s 内全部退出；双实例第二例 `gotLock=false` 立即消失不残留

## [0.4.1] - 2026-10-29

修复僵尸进程占单例锁导致双击无反应的问题。

### 修复

- **关窗口后进程残留变僵尸、占住单例锁**：`window-all-closed` 里 `await device.close()` 在串口异常时可能永久挂起，`app.quit()` 执行不到；改为与 1.5s 超时 `Promise.race` 兜底，退出不再被串口卡死
- **僵尸进程存在时双击彻底无反应**：`second-instance` 原来只在 `win` 存在时恢复/聚焦窗口，窗口已关的残留进程收到二次启动请求后什么都不做；现在 `win` 为空时直接 `createWindow()` 重建窗口

### 排查记录

- 现象：双击 `墨签.exe` 无反应；`app.log` 三条 `单例锁 gotLock=false`，新进程按设计退出，但旧实例窗口已关、`second-instance` 无窗可恢复
- 僵尸进程定位：`Get-Process | Where Path -like '*inkpad*'` 扫出 4 个残留 `墨签.exe`（主进程 + Chromium 子进程）；注意 Git Bash 下 `tasklist | iconv -f GBK` 会在非法字节处截断输出，查中文进程名不可靠

## [0.4.0] - 2026-10-28

桌面 UI 苹果风改版 + 侧栏可滚动 + AI 服务商选择。

### 新增

- **AI 服务商下拉**（`ui/app.js` VENDORS 预设表）：阿里云百炼（默认）/ 智谱 GLM / Kimi / DeepSeek / 自定义；切换时自动填入 baseUrl/model 默认值，两者仍可手改（兼容阿里专属 MaaS 端点）；模型输入带 datalist 建议列表，可手输任意模型名。**联动只在用户主动切换时触发**（select change 事件），启动/切模板回来绝不覆盖手改值
- **`tools/ui-shot.js` UI 截图目检脚本**：最小 IPC 桩 + 独立 `.userdata-ui` 沙盒，截 6 图（主界面/AI 卡表单/侧栏滚底/调试抽屉/WiFi 抽屉/空模板）+ 19 模板表单遍历兜底 + VENDOR_SMOKE 服务商联动冒烟，console 错误写 `out/ui-shot.log`

### 变更

- **桌面 UI 整体重写为 Apple 浅色设计语言**（`ui/style.css` 全量重写，类名不变）：macOS 色板（#007aff 蓝 / #f5f5f7 窗口底 / iOS systemGray6 输入底）、毛玻璃顶栏（saturate+blur）、iOS 灰底无框输入聚焦蓝环、select 自绘 chevron、macOS 胶囊分段控件（USB/WiFi）、iOS 设置页式分组卡表单（.card/.card-title/行式分隔线）、全局 6px 细滚动条、抽屉毛玻璃遮罩 + 弹入动画
- **左侧栏模板列表可滚动**：19 模板 ≈770px 原本几乎撑爆 860px 窗口；`.tpl-list` 加 `min-height:0; overflow-y:auto`，列表 DOM 幂等化（切模板只 toggle active 不重建，滚动位置不丢）
- 空模板（日期牌等）提示文字包进白色分组卡，与有字段模板视觉统一
- 主进程默认 AI 配置换阿里：store DEFAULTS（+provider:aliyun，baseUrl→dashscope，model→qwen3.8-flash）、`ai.js` 空配置兜底同步；窗口底色 #f5f5f7 防启动闪色

### 修复

- **表单 350ms 防抖吞多字段保存**：原单键版在防抖窗口内连改两个字段只落盘后者；重构为 `onFieldsChange(patch)` 多键一次写入（服务商切换即一次写 provider/baseUrl/model 三键），`onFieldChange` 变薄壳委托，既有调用点签名不变

### 验证

- selftest 全部通过；render-test 19/19 模板零错误（EXIT=0，色占比和≈100%，与 0.3.0 机制一致——模板与渲染管线未动）
- ui-shot 6 图 AI 目检通过（三栏布局/蓝色胶囊选中/分组卡/细滚动条/抽屉毛玻璃）；VENDOR_SMOKE：智谱↔阿里切换 baseUrl/model 联动正确
- `build-win.sh` 重打包，产物抽查 `--accent`/`VENDORS` 进 asar

## [0.3.0] - 2026-10-27

视觉改版三件套：日历改版（参照用户截图）、全模板对齐 InkSight 原版样式、三色化增强。

### 新增

- **日历模板整体改版**：黑底反白表头（周日/周六列红底）、无框 7 列网格、今日 22×22 红圆反白、右上两行红字 meta（干支年【生肖】/农历月日【第 N 周】）
- **节日白名单 `SOLAR_FESTS`**（`app/templates-extra.js`）：过滤 lunar-javascript `Solar.getFestivals()` 返回的"世界住房日"等联合国国际日，只保留主流节日；老黄历模板同款逻辑故意不动（老黄历本身就该罗列）
- **日历小字三级优先级**：节日 > 节气 > 农历（初一显示月名）；节日/节气/月初红字
- **居中红色短分隔线**（InkSight 标志性元素）：诗词标题下 60px、每日一词音标下 40px

### 变更

- **18 个模板字体整栈衬线化**：`"Noto Serif SC", "Source Han Serif SC", "SimSun", serif`（Windows 实际命中宋体；英文单词/音标 Georgia 优先）。注意：`"Microsoft YaHei", ..., serif` 这种栈实际命中雅黑，必须整栈替换
- **8 个模板页脚实线 → 虚线**（dashed）：weather/poetry/word/countdown/history/almanac/lifebar/year-progress/quote/ai-card
- **hero 大数字统一红色 #d02020**：天气 96px 温度、日读 84px 日期、信息看板 42px 日期
- **习惯打卡格**改实心红块 / 半红块（`.c.on` / `.c.half`）
- moyu/date-card/todo/memo/photo 五个模板仅衬线化（红色原本已够）

### 验证

- 19 模板全量渲染回归 EXIT=0；红占比 0.07%（photo 为 0 属正常）～5.01%（habit）
- 三图目检通过：84px 数字有衬线脚、短分隔线出现、诗词印章保留、小字可读、无溢出
- `build-win.sh` 重打包（272M），产物抽查：18 模板衬线栈、SOLAR_FESTS、日历黑条表头均在

### 已知限制（非 bug）

- <14px 宋体的衬线特征在 400×300 量化后丢失（横画仅 1px，视觉近似黑体），属墨水屏物理限制；衬线感 ≥20px 可辨。小字发虚时可单独回退黑体

## [0.2.0] - 2026-10-27

四项体验打磨 + AI 卡片问题修复。

### 新增

- **串口记忆与自动重连**：连接成功后存 `device.port`，下次启动 refreshPorts 后自动匹配连接（找不到提示不报错）；主动断开则清空
- **天气增加体感温度/风力**：Open-Meteo 加 `apparent_temperature` / `wind_speed_10m`，风力按蒲福等级换算（如"3 级"，`windLevel()` 边界 9 组验证全过）；右列 3→5 行（最高/最低/体感/风力/湿度），旧缓存无字段显示 "--"
- **待办拖动排序**：dashboard/todo 两模板的待办编辑器重写为行式 UI（勾选/紧急标记/删除/⠿ 拖动；grip mousedown 才启用 draggable 防误触；输入只 save 不 render 保焦点）
- **AI 卡片默认 API 改智谱 GLM**：`https://open.bigmodel.cn/api/paas/v4` + `glm-4.6`，保持 OpenAI 兼容（DeepSeek/百炼仍可在表单改）

### 修复

- **AI 卡片"填 key 点立即生成没反应"**：双因——①根因 GLM 账户余额不足（HTTP 429 code 1113，key 本身有效）②反馈只写调试抽屉日志，用户不开抽屉零感知。改为 `setBusy(true)` 禁用按钮 + 顶栏 `setStatus(err)` 红点显示

## [0.1.0] - 2026-10-26

初版，M1–M5 里程碑全部完成。动工方案见 `../PLAN-inkpad.md`（历史档案）。

- **M1 通路**：ESP32-C3 固件串口协议（PING/INFO/FRAME/SHOW/TEST/CAL/MODE/CFG/BLANK/RESET）、四段测试图、颜色校准向导（极性存 NVS，换屏点一次即可）、SHOW 相同 CRC 跳过省 13.4s 全刷
- **M2 渲染**：HTML 模板（`{{key}}` 占位）→ Electron 离屏渲染 400×300 → 三色量化（threshold 170 / Floyd–Steinberg 抖动）→ 2bpp 30000 字节帧；预览与上屏同一 HTML，所见即所推
- **M3 模板与存储**：19 个模板 + 表单编辑 + `%APPDATA%/inkpad/data.json` 持久化（deepMerge，数组整体替换）
- **M4 天气**：Open-Meteo 免 key、30 分钟缓存、离线降级标注数据时间
- **M5 打包**：`build-win.sh` 产出便携版（双击 墨签.exe 即用，免 Python/Node 环境）

> 初版开发期间未做逐项记录，本条为事后按规划文档与交接记录整理的概要。19 个模板：日期牌、金句、信息看板、备忘录、相框、天气、倒数日、老黄历、日历、日读、待办、诗词、每日一词、习惯、AI 卡片、摸鱼日历、人生进度、年进度、今日历史。

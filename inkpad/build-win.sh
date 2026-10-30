#!/usr/bin/env bash
# 打包 Windows 便携版：dist/墨签-win/墨签.exe
#
# 做法是手工组装（不引 electron-builder）：
#   1. 把 electron 官方发行包整份拷过去
#   2. 我们的代码放进 resources/app/
#   3. 生产依赖单独 npm install 一份（避免把 electron 自己也打进去）
#   4. electron.exe 改名成 墨签.exe
#
# 产物是文件夹形态，绿色免安装，拷到任何 Win10/11 都能跑。

set -euo pipefail

# pwd -W 拿 Windows 风格路径（E:/...）。用 /e/... 的话 Node 会当成 E:\e\...
ROOT="$(cd "$(dirname "$0")" && pwd -W)"
BUILD="$ROOT/build"
OUT="$ROOT/dist/墨签-win"
APP_NAME="墨签"
EXE_NAME="墨签.exe"

echo "== 清理 =="
# 沙箱会拦截批量删除（>50 个文件），删不掉也不能中断构建。
# 需要干净重来时，先手工删掉 build/ 和 dist/墨签-win 再跑。
rm -rf "$BUILD" "$OUT" 2>/dev/null || echo "  （旧目录未能删除，继续覆盖）"
mkdir -p "$BUILD/app" "$OUT"

echo "== 准备应用代码 =="
cp -r "$ROOT/app" "$BUILD/app/app"
cp -r "$ROOT/ui" "$BUILD/app/ui"
[ -d "$ROOT/assets" ] && cp -r "$ROOT/assets" "$BUILD/app/assets"

# package.json 去掉 devDependencies，只留生产依赖
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
delete p.devDependencies;
p.scripts = {};
p.description = "墨签 · 4.2 寸电子价签桌面应用";
fs.writeFileSync(process.argv[2], JSON.stringify(p, null, 2));
' "$ROOT/package.json" "$BUILD/app/package.json"

echo "== 安装生产依赖 =="
( cd "$BUILD/app" && npm install --omit=dev --no-audit --no-fund \
    --registry=https://registry.npmmirror.com )

echo "== 拷贝 Electron 运行时 =="
cp -r "$ROOT/node_modules/electron/dist/." "$OUT/"

echo "== 放入应用 =="
mkdir -p "$OUT/resources/app"
cp -r "$BUILD/app/." "$OUT/resources/app/"

echo "== 改名 =="
mv "$OUT/electron.exe" "$OUT/$EXE_NAME"

echo "== 体积 =="
du -sh "$OUT"

echo ""
echo "完成：$OUT"
echo "双击 $EXE_NAME 即可运行"

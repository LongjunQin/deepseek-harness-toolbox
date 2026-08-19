#!/bin/zsh
# 构建 DeepSeek Harness.app 到上级目录
set -euo pipefail
cd "$(dirname "$0")"

# 产物放隐藏目录,避免被 Spotlight/启动台索引成"第二个App"
APP="./.build/DeepSeek Harness.app"
mkdir -p ./.build
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "== 编译 =="
swiftc -O -swift-version 5 -o "$APP/Contents/MacOS/DeepSeekHarness" main.swift setup.swift \
  -framework Cocoa -framework WebKit

cp Info.plist "$APP/Contents/"

echo "== 打包插件 =="
# 插件随 App 分发:首次启动时自动装配进用户的 ~/.dsh(见 setup.swift)
PLUGIN_SRC="../plugins"
if [ -d "$PLUGIN_SRC" ]; then
  mkdir -p "$APP/Contents/Resources/plugins"
  for p in dsh-cost-display dsh-annotate dsh-image-relay dsh-theme-aluminum; do
    if [ -d "$PLUGIN_SRC/$p" ]; then
      rsync -a --exclude node_modules --exclude .git "$PLUGIN_SRC/$p" "$APP/Contents/Resources/plugins/"
      echo "  + $p"
    fi
  done
fi

echo "== 图标 =="
TMPDIR_ICON=$(mktemp -d)
ICONSET="$TMPDIR_ICON/AppIcon.iconset"
mkdir -p "$ICONSET"
# 优先用设计定稿的图标(官方鲸鱼+水晶玻璃蓝);缺失时回退到程序生成
if [ -f AppIcon-1024.png ]; then
  cp AppIcon-1024.png "$TMPDIR_ICON/icon1024.png"
else
  swift makeicon.swift "$TMPDIR_ICON/icon1024.png"
fi
cp "$TMPDIR_ICON/icon1024.png" "$ICONSET/icon_512x512@2x.png"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMPDIR_ICON/icon1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$TMPDIR_ICON/icon1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$TMPDIR_ICON"

echo "== 签名 =="
codesign --force -s - "$APP"

echo "构建完成: $APP"

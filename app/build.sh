#!/bin/zsh
# 构建 DeepSeek Harness.app 到上级目录
set -euo pipefail
cd "$(dirname "$0")"

APP="../DeepSeek Harness.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "== 编译 =="
swiftc -O -swift-version 5 -o "$APP/Contents/MacOS/DeepSeekHarness" main.swift \
  -framework Cocoa -framework WebKit

cp Info.plist "$APP/Contents/"

echo "== 图标 =="
TMPDIR_ICON=$(mktemp -d)
ICONSET="$TMPDIR_ICON/AppIcon.iconset"
mkdir -p "$ICONSET"
swift makeicon.swift "$TMPDIR_ICON/icon1024.png"
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

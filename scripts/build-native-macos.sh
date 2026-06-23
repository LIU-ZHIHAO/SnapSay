#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE_DIR="$ROOT_DIR/native-macos"
OUT_DIR="$ROOT_DIR/release/native-macos"
APP_DIR="$OUT_DIR/SnapSay.app"
LEGACY_APP_DIR="$OUT_DIR/SnapSay Native.app"

cd "$NATIVE_DIR"
swift build -c release

rm -rf "$APP_DIR" "$LEGACY_APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp ".build/release/SnapSay" "$APP_DIR/Contents/MacOS/SnapSay"
cp "$NATIVE_DIR/Resources/Info.plist" "$APP_DIR/Contents/Info.plist"
cp "$ROOT_DIR/scripts/asr-daemon-onnx.py" "$APP_DIR/Contents/Resources/asr-daemon-onnx.py"
cp "$ROOT_DIR/scripts/setup-onnx-asr-macos.sh" "$APP_DIR/Contents/Resources/setup-onnx-asr-macos.sh"

ICON_SRC="$ROOT_DIR/src/renderer/logo.png"
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$APP_DIR/Contents/Resources/StatusIcon.png"
  ICONSET="$APP_DIR/Contents/Resources/AppIcon.iconset"
  mkdir -p "$ICONSET"
  sips -z 16 16 "$ICON_SRC" --out "$ICONSET/icon_16x16.png" >/dev/null
  sips -z 32 32 "$ICON_SRC" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$ICON_SRC" --out "$ICONSET/icon_32x32.png" >/dev/null
  sips -z 64 64 "$ICON_SRC" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$ICON_SRC" --out "$ICONSET/icon_128x128.png" >/dev/null
  sips -z 256 256 "$ICON_SRC" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$ICON_SRC" --out "$ICONSET/icon_256x256.png" >/dev/null
  sips -z 512 512 "$ICON_SRC" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$ICON_SRC" --out "$ICONSET/icon_512x512.png" >/dev/null
  sips -z 1024 1024 "$ICON_SRC" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "$ICONSET" -o "$APP_DIR/Contents/Resources/AppIcon.icns"
  rm -rf "$ICONSET"
fi

if [ -d "$ROOT_DIR/dist" ]; then
  mkdir -p "$APP_DIR/Contents/Resources/web"
  ditto "$ROOT_DIR/dist" "$APP_DIR/Contents/Resources/web"
  "$ROOT_DIR/node_modules/.bin/esbuild" "$ROOT_DIR/src/renderer/main.tsx" \
    --bundle \
    --format=iife \
    --platform=browser \
    --target=safari16 \
    --outfile="$APP_DIR/Contents/Resources/web/snapsay-main.js" \
    --loader:.png=file \
    --loader:.svg=file \
    '--asset-names=assets/[name]-[hash]' \
    --define:process.env.NODE_ENV='"production"' \
    --log-level=warning
  cat > "$APP_DIR/Contents/Resources/web/index.html" <<'HTML'
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SnapSay</title>
    <link rel="stylesheet" href="./snapsay-main.css" />
    <script defer src="./snapsay-main.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
HTML
fi

if security find-identity -v -p codesigning | grep -q "SnapSay Local Code Signing"; then
  codesign --force --deep --sign "SnapSay Local Code Signing" "$APP_DIR" >/dev/null
else
  codesign --force --deep --sign - "$APP_DIR" >/dev/null
fi

rm -f "$OUT_DIR/SnapSay-macOS.zip"
(cd "$OUT_DIR" && ditto -c -k --sequesterRsrc --keepParent "SnapSay.app" "SnapSay-macOS.zip")

echo "$APP_DIR"

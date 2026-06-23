#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/release/macos-paste-helper"
mkdir -p "$OUT_DIR"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc is required to build the macOS paste helper" >&2
  exit 1
fi

swiftc "$ROOT_DIR/scripts/macos-paste-helper.swift" -O -o "$OUT_DIR/SnapSayPasteHelper"

if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - --identifier cn.snapsay.desktop "$OUT_DIR/SnapSayPasteHelper" >/dev/null
fi

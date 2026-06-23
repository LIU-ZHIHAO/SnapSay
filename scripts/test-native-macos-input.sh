#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="${1:-$ROOT_DIR/release/native-macos/SnapSay.app}"
EXECUTABLE="$APP_DIR/Contents/MacOS/SnapSay"
TEST_TEXT="SnapSay input test $(date +%s)"
CLIPBOARD_TEXT="SnapSay clipboard sentinel $(date +%s)"

if [[ ! -x "$EXECUTABLE" ]]; then
  echo "Missing executable: $EXECUTABLE" >&2
  exit 1
fi

printf "%s" "$CLIPBOARD_TEXT" | pbcopy

osascript <<'APPLESCRIPT'
tell application "TextEdit"
  activate
  close every document saving no
  make new document
  set text of front document to ""
end tell
APPLESCRIPT

sleep 1
(
  sleep 1.2
  "$EXECUTABLE" --self-test-paste-no-restore "$TEST_TEXT" >/tmp/snapsay-paste-test.log
) &
PASTE_PID=$!
osascript <<'APPLESCRIPT'
tell application "TextEdit"
  activate
end tell
APPLESCRIPT
wait "$PASTE_PID"
sleep 1

ACTUAL_TEXT="$(osascript <<'APPLESCRIPT'
tell application "TextEdit"
  get text of front document
end tell
APPLESCRIPT
)"

osascript <<'APPLESCRIPT' >/dev/null 2>&1 || true
tell application "TextEdit"
  close front document saving no
end tell
APPLESCRIPT

if [[ "$ACTUAL_TEXT" != *"$TEST_TEXT"* ]]; then
  echo "Expected TextEdit to contain: $TEST_TEXT" >&2
  echo "Actual TextEdit text: $ACTUAL_TEXT" >&2
  cat /tmp/snapsay-paste-test.log >&2 || true
  exit 1
fi

cat /tmp/snapsay-paste-test.log
echo "input-ok text=$TEST_TEXT"

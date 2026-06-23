import CoreGraphics
import Foundation
import ApplicationServices

if !AXIsProcessTrusted() {
  fputs("SnapSayPasteHelper is not trusted for Accessibility\n", stderr)
  exit(3)
}

let keyV: CGKeyCode = 0x09
let source = CGEventSource(stateID: .combinedSessionState)

func postKey(_ key: CGKeyCode, down: Bool, flags: CGEventFlags = []) {
  guard let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: down) else {
    exit(2)
  }
  event.flags = flags
  event.post(tap: .cghidEventTap)
}

usleep(80_000)
postKey(keyV, down: true, flags: .maskCommand)
usleep(20_000)
postKey(keyV, down: false, flags: .maskCommand)

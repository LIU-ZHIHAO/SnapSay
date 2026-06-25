import AppKit
import AVFoundation
import Carbon
import CoreAudio
import CoreGraphics
import Darwin
import Foundation
import Speech
import UniformTypeIdentifiers
@preconcurrency import WebKit

private let appName = "SnapSay"
private let hotKeySignature = OSType(0x534E4150) // SNAP
private let hotKeyID = UInt32(1)
private let runtimeRoot = FileManager.default.homeDirectoryForCurrentUser
  .appendingPathComponent("Library/Application Support/SnapSay", isDirectory: true)
private let dataDir = runtimeRoot.appendingPathComponent("data", isDirectory: true)
private let logsDir = runtimeRoot.appendingPathComponent("logs", isDirectory: true)
private let modelDir = runtimeRoot.appendingPathComponent("models/sensevoice/SenseVoiceSmall", isDirectory: true)
private let pythonPath = runtimeRoot.appendingPathComponent(".venv/bin/python")
private let portFile = runtimeRoot.appendingPathComponent("data/asr-daemon.port")
private let lockFile = runtimeRoot.appendingPathComponent("data/asr-daemon.lock")
private let tempDir = runtimeRoot.appendingPathComponent("tmp/snapsay", isDirectory: true)
private let settingsFile = dataDir.appendingPathComponent("snapsay-settings.json")
private let recordDbFile = dataDir.appendingPathComponent("snapsay.db")
private let capsulePositionFile = dataDir.appendingPathComponent("capsule-position.json")
private let cleanupMinEffectiveChars = 30
private let senseVoiceOnnxFiles: [(url: String, name: String, minBytes: Int)] = [
  ("https://www.modelscope.cn/models/iic/SenseVoiceSmall-onnx/resolve/master/model_quant.onnx", "model.onnx", 10 * 1024 * 1024),
  ("https://www.modelscope.cn/models/iic/SenseVoiceSmall-onnx/resolve/master/tokens.json", "tokens.json", 1024),
  ("https://www.modelscope.cn/models/iic/SenseVoiceSmall-onnx/resolve/master/am.mvn", "am.mvn", 1024)
]
private let snapsayRecordsChangedNotification = Notification.Name("SnapSayRecordsChanged")
private let snapsayWindowControlNotification = Notification.Name("SnapSayWindowControl")
private let snapsayRecordingStartNotification = Notification.Name("SnapSayRecordingStart")
private let snapsayRecordingStopNotification = Notification.Name("SnapSayRecordingStop")
private let snapsaySettingsChangedNotification = Notification.Name("SnapSaySettingsChanged")
private let snapsayLocalAsrRequiredNotification = Notification.Name("SnapSayLocalAsrRequired")
private let defaultCleanupPrompt = """
任务：精修语音转写文本，输出可直接发送的干净文字。
1. 纠错与降噪：修复语音错字；删除语气词及重复词。精准识别改口，直接删除被推翻的前文，无缝拼接最终确认内容。
2. 忠于原意：保留第一人称，绝不擅自扩写、总结或改变原本语气。
3. 排版切分：按聊天阅读习惯拆分长句。按完整语义、转折、结论自然换行分段。
4. 严格输出：仅输出最终结果，禁止回复原文本内容！绝对禁止包含解释、标题、引号、Markdown格式，严禁在句末加任何结束标点（如。，）。
"""

func appLog(_ message: String) {
  try? FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
  let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(message)\n"
  let file = logsDir.appendingPathComponent("snapsay-app.log")
  if let data = line.data(using: .utf8) {
    if FileManager.default.fileExists(atPath: file.path),
       let handle = try? FileHandle(forWritingTo: file) {
      handle.seekToEndOfFile()
      try? handle.write(contentsOf: data)
      try? handle.close()
    } else {
      try? data.write(to: file)
    }
  }
}

func postAppNotification(_ name: Notification.Name, object: Any? = nil) {
  DispatchQueue.main.async {
    NotificationCenter.default.post(name: name, object: object)
  }
}

func jsonLiteral(_ value: Any, fallback: String = "null") -> String {
  let normalized = normalizeForJSON(value)
  guard JSONSerialization.isValidJSONObject(normalized) || normalized is String || normalized is NSNumber || normalized is NSNull else {
    return fallback
  }
  do {
    let data = try JSONSerialization.data(withJSONObject: normalized, options: [.fragmentsAllowed])
    return String(data: data, encoding: .utf8) ?? fallback
  } catch {
    appLog("json serialization failed error=\(error.localizedDescription)")
    return fallback
  }
}

func areJsonEqual(_ lhs: Any?, _ rhs: Any?) -> Bool {
  guard let lhs, let rhs else { return false }
  let normalizedLhs = normalizeForJSON(lhs)
  let normalizedRhs = normalizeForJSON(rhs)
  guard (JSONSerialization.isValidJSONObject(normalizedLhs) || normalizedLhs is String || normalizedLhs is NSNumber || normalizedLhs is NSNull),
        (JSONSerialization.isValidJSONObject(normalizedRhs) || normalizedRhs is String || normalizedRhs is NSNumber || normalizedRhs is NSNull),
        let lhsData = try? JSONSerialization.data(withJSONObject: normalizedLhs, options: [.fragmentsAllowed, .sortedKeys]),
        let rhsData = try? JSONSerialization.data(withJSONObject: normalizedRhs, options: [.fragmentsAllowed, .sortedKeys]) else {
    return false
  }
  return lhsData == rhsData
}

func normalizeForJSON(_ value: Any) -> Any {
  let mirror = Mirror(reflecting: value)
  if mirror.displayStyle == .optional {
    guard let child = mirror.children.first else { return NSNull() }
    return normalizeForJSON(child.value)
  }
  switch value {
  case let dictionary as [String: Any]:
    return dictionary.mapValues { normalizeForJSON($0) }
  case let array as [Any]:
    return array.map { normalizeForJSON($0) }
  default:
    return value
  }
}

func runProcess(executable: URL, arguments: [String], environment: [String: String], logName: String) async throws {
  try await withCheckedThrowingContinuation { continuation in
    do {
      try FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
      let outLog = logsDir.appendingPathComponent("\(logName).out.log")
      let errLog = logsDir.appendingPathComponent("\(logName).err.log")
      FileManager.default.createFile(atPath: outLog.path, contents: nil)
      FileManager.default.createFile(atPath: errLog.path, contents: nil)
      let outHandle = try FileHandle(forWritingTo: outLog)
      let errHandle = try FileHandle(forWritingTo: errLog)
      outHandle.seekToEndOfFile()
      errHandle.seekToEndOfFile()
      let process = Process()
      process.executableURL = executable
      process.arguments = arguments
      process.environment = ProcessInfo.processInfo.environment.merging(environment) { _, new in new }
      process.standardOutput = outHandle
      process.standardError = errHandle
      process.terminationHandler = { process in
        try? outHandle.close()
        try? errHandle.close()
        if process.terminationStatus == 0 {
          continuation.resume()
        } else {
          continuation.resume(throwing: NSError(domain: appName, code: Int(process.terminationStatus), userInfo: [
            NSLocalizedDescriptionKey: "命令执行失败：\(executable.path) \(arguments.joined(separator: " "))，请查看日志 \(errLog.path)"
          ]))
        }
      }
      try process.run()
    } catch {
      continuation.resume(throwing: error)
    }
  }
}

func localAsrRuntimeReady() -> Bool {
  guard FileManager.default.isExecutableFile(atPath: pythonPath.path) else {
    return false
  }
  let process = Process()
  process.executableURL = pythonPath
  process.arguments = ["-c", "import numpy, av, kaldi_native_fbank, onnxruntime"]
  process.standardOutput = Pipe()
  process.standardError = Pipe()
  do {
    try process.run()
    process.waitUntilExit()
    return process.terminationStatus == 0
  } catch {
    return false
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var statusItem: NSStatusItem!
  private let floating = FloatingCapsuleController()
  private let recorder = AudioRecorder()
  private let daemon = ASRDaemonManager()
  private let asrClient = ASRDaemonClient(portFile: portFile)
  private let systemAsrClient = SystemSpeechClient()
  private let settingsStore = SnapSaySettingsStore()
  private let cleanupClient = CleanupClient()
  private let recordStore = SnapSayRecordStore()
  private let cloudAsrClient = CloudAsrClient()
  private let paste = PasteController()
  private var mainWindowController: MainWindowController?
  private var isRecording = false
  private var hotKeyRef: EventHotKeyRef?
  private var hotKeyHandlerRef: EventHandlerRef?
  private var keyboardEventTap: CFMachPort?
  private var keyboardRunLoopSource: CFRunLoopSource?
  private var activeHotKeyConfig = HotKeyConfig.default
  private var swallowingHotKeyCode: Int64?
  private var hotKeyLongPressWorkItem: DispatchWorkItem?
  private var hotKeyLongPressActivated = false
  private var localKeyMonitor: Any?
  private var mouseEventTap: CFMachPort?
  private var mouseRunLoopSource: CFRunLoopSource?
  private var recordingSessionID: UInt64 = 0
  private var processingSessionIDs = Set<UInt64>()

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    setupStatusItem()
    setupMainMenu()
    setupLocalKeyMonitor()
    createRuntimeDirectories()
    logPermissionState()
    requestAccessibilityIfNeeded()
    registerInputTriggers()
    NotificationCenter.default.addObserver(self, selector: #selector(settingsChanged), name: snapsaySettingsChangedNotification, object: nil)
    syncAsrDaemonForCurrentSettings()
    DispatchQueue.main.async { [weak self] in
      self?.openMainWindow()
    }
  }

  func applicationWillTerminate(_ notification: Notification) {
    if let hotKeyRef {
      UnregisterEventHotKey(hotKeyRef)
    }
    if let hotKeyHandlerRef {
      RemoveEventHandler(hotKeyHandlerRef)
    }
    if let localKeyMonitor {
      NSEvent.removeMonitor(localKeyMonitor)
      self.localKeyMonitor = nil
    }
    unregisterKeyboardEventTap()
    unregisterMouseTrigger()
    daemon.reset()
    NotificationCenter.default.removeObserver(self)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    openMainWindow()
    return true
  }

  @objc private func settingsChanged() {
    registerInputTriggers()
    syncAsrDaemonForCurrentSettings()
  }

  private func registerInputTriggers() {
    registerHotKey()
    registerMouseTrigger()
  }

  private func syncAsrDaemonForCurrentSettings() {
    if settingsStore.load().asrProfile.kind == .local {
      daemon.startIfNeeded()
    } else {
      daemon.reset()
      SnapSayLocalAsrNoticeStore.shared.clear()
      appLog("local ASR daemon stopped because active ASR profile is cloud")
    }
  }

  private func createRuntimeDirectories() {
    try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
    try? FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
    try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
  }

  private func setupStatusItem() {
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    if let image = NSImage(contentsOf: Bundle.main.resourceURL?.appendingPathComponent("StatusIcon.png") ?? URL(fileURLWithPath: "")) {
      image.size = NSSize(width: 18, height: 18)
      image.isTemplate = false
      statusItem.button?.image = image
      statusItem.button?.imagePosition = .imageOnly
      statusItem.button?.toolTip = "SnapSay"
    } else {
      statusItem.button?.title = "S"
    }
    let menu = NSMenu()
    menu.addItem(menuItem(title: "打开 SnapSay", action: #selector(openMainWindow)))
    menu.addItem(menuItem(title: "开始/停止录音", action: #selector(toggleRecording)))
    menu.addItem(.separator())
    menu.addItem(menuItem(title: "打开麦克风权限", action: #selector(openMicrophoneSettings)))
    menu.addItem(menuItem(title: "打开辅助功能权限", action: #selector(openAccessibilitySettings)))
    menu.addItem(.separator())
    menu.addItem(menuItem(title: "退出", action: #selector(quit), keyEquivalent: "q"))
    statusItem.menu = menu
  }

  private func setupMainMenu() {
    let mainMenu = NSMenu()
    let appMenuItem = NSMenuItem()
    let appMenu = NSMenu()
    let openItem = NSMenuItem(title: "打开 SnapSay", action: #selector(openMainWindow), keyEquivalent: ",")
    openItem.target = self
    appMenu.addItem(openItem)
    appMenu.addItem(.separator())
    let quitItem = NSMenuItem(title: "退出 SnapSay", action: #selector(quit), keyEquivalent: "q")
    quitItem.target = self
    appMenu.addItem(quitItem)
    appMenuItem.submenu = appMenu
    mainMenu.addItem(appMenuItem)
    mainMenu.addItem(standardEditMenuItem())
    NSApp.mainMenu = mainMenu
  }

  private func setupLocalKeyMonitor() {
    localKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      guard event.modifierFlags.contains(.command),
            event.charactersIgnoringModifiers?.lowercased() == "q" else {
        return event
      }
      self?.quit()
      return nil
    }
  }

  private func menuItem(title: String, action: Selector, keyEquivalent: String = "") -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
    item.target = self
    return item
  }

  @objc private func quit() {
    NSApp.terminate(nil)
  }

  @objc private func openMainWindow() {
    if mainWindowController == nil {
      mainWindowController = MainWindowController()
    }
    appLog("main window requested")
    mainWindowController?.show()
  }

  @objc private func openMicrophoneSettings() {
    SettingsOpener.openMicrophone()
  }

  @objc private func openAccessibilitySettings() {
    SettingsOpener.openAccessibility()
  }

  private func logPermissionState() {
    appLog("permission microphone=\(AVCaptureDevice.authorizationStatus(for: .audio).rawValue) accessibility=\(AXIsProcessTrusted())")
  }

  private func requestAccessibilityIfNeeded() {
    guard !AXIsProcessTrusted() else { return }
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
  }

  private func requestMicrophoneIfNeeded() {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .audio) { granted in
        appLog("microphone prompt result=\(granted)")
      }
    case .denied, .restricted:
      SettingsOpener.openMicrophone()
    default:
      break
    }
  }

  private func registerHotKey() {
    if let hotKeyRef {
      UnregisterEventHotKey(hotKeyRef)
      self.hotKeyRef = nil
    }
    if let hotKeyHandlerRef {
      RemoveEventHandler(hotKeyHandlerRef)
      self.hotKeyHandlerRef = nil
    }
    let settings = settingsStore.load()
    let config = settings.hotKey
    activeHotKeyConfig = config
    let modifiers = config.modifiers
    let keyCode = config.keyCode
    var registeredHotKey: EventHotKeyRef?
    let hotKeyStatus = RegisterEventHotKey(keyCode, modifiers, EventHotKeyID(signature: hotKeySignature, id: hotKeyID), GetApplicationEventTarget(), 0, &registeredHotKey)
    if hotKeyStatus == noErr, let registeredHotKey {
      hotKeyRef = registeredHotKey
    } else {
      appLog("hotkey registration failed status=\(hotKeyStatus)")
    }

    var handlerStatus: OSStatus = noErr
    if hotKeyRef != nil {
      var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
      handlerStatus = InstallEventHandler(GetApplicationEventTarget(), { _, event, userData in
        guard let userData else { return noErr }
        var hotKey = EventHotKeyID()
        GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &hotKey)
        if hotKey.signature == hotKeySignature && hotKey.id == hotKeyID {
          let app = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
          DispatchQueue.main.async { app.toggleRecording() }
        }
        return noErr
      }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), &hotKeyHandlerRef)
    }
    appLog("hotkey registered label=\(config.label) keyCode=\(keyCode) modifiers=\(modifiers) handlerStatus=\(handlerStatus)")
    if handlerStatus != noErr {
      floating.show(status: "快捷键监听失败", kind: .failed)
    }
    registerKeyboardEventTapIfPossible()
  }

  private func registerKeyboardEventTapIfPossible() {
    unregisterKeyboardEventTap()
    guard AXIsProcessTrusted() else {
      appLog("keyboard event tap waiting for accessibility permission")
      return
    }
    let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
    guard let tap = CGEvent.tapCreate(
      tap: .cgSessionEventTap,
      place: .headInsertEventTap,
      options: .defaultTap,
      eventsOfInterest: CGEventMask(mask),
      callback: { _, type, event, userData in
        guard let userData else { return Unmanaged.passUnretained(event) }
        let app = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
        if app.shouldSwallowHotKeyEvent(type: type, event: event) {
          return nil
        }
        return Unmanaged.passUnretained(event)
      },
      userInfo: Unmanaged.passUnretained(self).toOpaque()
    ) else {
      appLog("keyboard event tap registration failed")
      return
    }
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    keyboardEventTap = tap
    keyboardRunLoopSource = source
    appLog("keyboard event tap registered for hotkey=\(activeHotKeyConfig.label)")
  }

  private func unregisterKeyboardEventTap() {
    if let keyboardRunLoopSource {
      CFRunLoopRemoveSource(CFRunLoopGetMain(), keyboardRunLoopSource, .commonModes)
      self.keyboardRunLoopSource = nil
    }
    if let keyboardEventTap {
      CFMachPortInvalidate(keyboardEventTap)
      self.keyboardEventTap = nil
    }
    swallowingHotKeyCode = nil
    hotKeyLongPressWorkItem?.cancel()
    hotKeyLongPressWorkItem = nil
    hotKeyLongPressActivated = false
  }

  private func shouldSwallowHotKeyEvent(type: CGEventType, event: CGEvent) -> Bool {
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    switch type {
    case .keyDown:
      if swallowingHotKeyCode == keyCode {
        return true
      }
      guard keyCode == Int64(activeHotKeyConfig.keyCode),
            event.flags.match(carbonModifiers: activeHotKeyConfig.modifiers) else {
        return false
      }
      swallowingHotKeyCode = keyCode
      hotKeyLongPressActivated = false
      scheduleLongPressHotKey()
      return true
    case .keyUp:
      if swallowingHotKeyCode == keyCode {
        finishHotKeyPress()
        swallowingHotKeyCode = nil
        return true
      }
      return false
    default:
      return false
    }
  }

  private func scheduleLongPressHotKey() {
    hotKeyLongPressWorkItem?.cancel()
    let workItem = DispatchWorkItem { [weak self] in
      guard let self, self.swallowingHotKeyCode != nil else { return }
      self.hotKeyLongPressActivated = true
      let action = self.settingsStore.load().longPressAction
      appLog("hotkey long press activated action=\(action)")
      if !self.isRecording {
        self.startRecording()
      }
    }
    hotKeyLongPressWorkItem = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45, execute: workItem)
  }

  private func finishHotKeyPress() {
    hotKeyLongPressWorkItem?.cancel()
    hotKeyLongPressWorkItem = nil
    if hotKeyLongPressActivated {
      hotKeyLongPressActivated = false
      let action = settingsStore.load().longPressAction
      appLog("hotkey long press released action=\(action)")
      if isRecording {
        stopRecording()
      }
      return
    }
    appLog("hotkey short press triggered")
    toggleRecording()
  }

  private func registerMouseTrigger() {
    unregisterMouseTrigger()
    let settings = settingsStore.load()
    guard settings.smartMouseMode else {
      appLog("mouse trigger disabled by smartMouseMode=false")
      return
    }
    guard let trigger = settings.mouseTrigger else {
      appLog("mouse trigger unsupported label=\(settings.mouseTriggerLabel)")
      return
    }
    guard AXIsProcessTrusted() else {
      requestAccessibilityIfNeeded()
      appLog("mouse trigger waiting for accessibility permission")
      return
    }

    let mask = (1 << CGEventType.leftMouseDown.rawValue)
      | (1 << CGEventType.rightMouseDown.rawValue)
      | (1 << CGEventType.otherMouseDown.rawValue)
    guard let tap = CGEvent.tapCreate(
      tap: .cgSessionEventTap,
      place: .headInsertEventTap,
      options: .listenOnly,
      eventsOfInterest: CGEventMask(mask),
      callback: { _, type, event, userData in
        guard let userData else { return Unmanaged.passUnretained(event) }
        let app = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
        if app.shouldHandleMouseTrigger(type: type, event: event) {
          DispatchQueue.main.async { app.toggleRecording() }
        }
        return Unmanaged.passUnretained(event)
      },
      userInfo: Unmanaged.passUnretained(self).toOpaque()
    ) else {
      appLog("mouse trigger registration failed label=\(trigger.label)")
      return
    }
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    mouseEventTap = tap
    mouseRunLoopSource = source
    appLog("mouse trigger registered label=\(trigger.label) button=\(trigger.buttonNumber)")
  }

  private func unregisterMouseTrigger() {
    if let mouseRunLoopSource {
      CFRunLoopRemoveSource(CFRunLoopGetMain(), mouseRunLoopSource, .commonModes)
      self.mouseRunLoopSource = nil
    }
    if let mouseEventTap {
      CFMachPortInvalidate(mouseEventTap)
      self.mouseEventTap = nil
    }
  }

  private func shouldHandleMouseTrigger(type: CGEventType, event: CGEvent) -> Bool {
    let settings = settingsStore.load()
    guard settings.smartMouseMode, let trigger = settings.mouseTrigger else { return false }
    let button = Int(event.getIntegerValueField(.mouseEventButtonNumber))
    switch type {
    case .leftMouseDown:
      return trigger.buttonNumber == 0
    case .rightMouseDown:
      return trigger.buttonNumber == 1
    case .otherMouseDown:
      return button == trigger.buttonNumber
    default:
      return false
    }
  }

  @objc private func toggleRecording() {
    if isRecording {
      stopRecording()
    } else {
      startRecording()
    }
  }

  private func startRecording() {
    let microphoneStatus = AVCaptureDevice.authorizationStatus(for: .audio)
    guard microphoneStatus == .authorized else {
      if microphoneStatus == .notDetermined {
        AVCaptureDevice.requestAccess(for: .audio) { granted in
          appLog("microphone prompt result=\(granted)")
        }
      } else {
        requestMicrophoneIfNeeded()
      }
      floating.show(status: "需要麦克风权限", kind: .failed)
      appLog("recording blocked microphoneStatus=\(microphoneStatus.rawValue)")
      return
    }
    do {
      let settings = settingsStore.load()
      let url = tempDir.appendingPathComponent("recording-\(Int(Date().timeIntervalSince1970)).wav")
      try recorder.start(url: url, microphoneDeviceId: settings.microphoneDeviceId)
      recordingSessionID &+= 1
      isRecording = true
      floating.show(status: "录音中", kind: .recording)
      postAppNotification(snapsayRecordingStartNotification)
      appLog("recording started url=\(url.path) microphoneDeviceId=\(settings.microphoneDeviceId)")
    } catch {
      floating.show(status: "录音失败", kind: .failed)
      appLog("recording start failed: \((error as NSError).localizedDescription)")
    }
  }

  private func stopRecording() {
    guard isRecording else { return }
    isRecording = false
    guard let url = recorder.stop() else {
      floating.show(status: "录音失败", kind: .failed)
      appLog("recording stop failed: missing file url")
      return
    }
    let sessionID = recordingSessionID
    processingSessionIDs.insert(sessionID)
    floating.show(status: "转写中", kind: .recognizing)
    postAppNotification(snapsayRecordingStopNotification)
    Task.detached { [weak app = self, daemon, asrClient, systemAsrClient, cloudAsrClient, settingsStore, cleanupClient, recordStore, paste] in
      guard let app else { return }
      do {
        let audio = try Data(contentsOf: url)
        appLog("recording stopped bytes=\(audio.count) url=\(url.path)")
        let result = try await SnapSayRecordingPipeline(
          daemon: daemon,
          asrClient: asrClient,
          systemAsrClient: systemAsrClient,
          cloudAsrClient: cloudAsrClient,
          settingsStore: settingsStore,
          cleanupClient: cleanupClient,
          recordStore: recordStore,
          paste: paste
        ).process(
          audio: audio,
          status: { status, kind in
            await app.showCapsuleIfCurrent(sessionID: sessionID, status: status, kind: kind)
          }
        )
        await app.finishProcessing(sessionID: sessionID, status: result["completionStatus"] as? String ?? "已复制", kind: .done)
      } catch {
        let nsError = error as NSError
        let status = nsError.code == 20 ? "需要辅助功能" : (nsError.code == 90 ? "没有识别到文本" : "转写失败")
        await app.finishProcessing(sessionID: sessionID, status: status, kind: .failed)
      }
    }
  }

  private func showCapsuleIfCurrent(sessionID: UInt64, status: String, kind: CapsuleKind) {
    guard recordingSessionID == sessionID, processingSessionIDs.contains(sessionID) else {
      appLog("ignored stale capsule status session=\(sessionID) current=\(recordingSessionID) status=\(status)")
      return
    }
    floating.show(status: status, kind: kind)
  }

  private func finishProcessing(sessionID: UInt64, status: String, kind: CapsuleKind) {
    processingSessionIDs.remove(sessionID)
    guard recordingSessionID == sessionID else {
      appLog("ignored stale processing finish session=\(sessionID) current=\(recordingSessionID) status=\(status)")
      return
    }
    floating.show(status: status, kind: kind)
  }
}

func standardEditMenuItem() -> NSMenuItem {
  let editMenuItem = NSMenuItem()
  let editMenu = NSMenu(title: "编辑")
  editMenu.addItem(NSMenuItem(title: "撤销", action: Selector(("undo:")), keyEquivalent: "z"))
  editMenu.addItem(NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "Z"))
  editMenu.addItem(.separator())
  editMenu.addItem(NSMenuItem(title: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
  editMenu.addItem(NSMenuItem(title: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
  editMenu.addItem(NSMenuItem(title: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
  editMenu.addItem(NSMenuItem(title: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
  editMenuItem.submenu = editMenu
  return editMenuItem
}

func transcribeWithLocalRecovery(audio: Data, daemon: ASRDaemonManager, asrClient: ASRDaemonClient) async throws -> String {
  do {
    return try await asrClient.transcribe(audio: audio)
  } catch {
    appLog("local asr failed once, restarting daemon: \(error.localizedDescription)")
    daemon.reset()
    try daemon.ensureRunning()
    return try await asrClient.transcribe(audio: audio)
  }
}

final class SystemSpeechClient: @unchecked Sendable {
  func transcribe(audio: Data, localeIdentifier: String = "zh_CN") async throws -> String {
    try await ensureAuthorized()
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier)) else {
      throw NSError(domain: appName, code: 120, userInfo: [NSLocalizedDescriptionKey: "当前系统不支持 \(localeIdentifier) 语音识别"])
    }
    guard recognizer.isAvailable else {
      throw NSError(domain: appName, code: 121, userInfo: [NSLocalizedDescriptionKey: "系统语音识别暂不可用，请稍后重试或切换本地 ONNX"])
    }

    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    let url = tempDir.appendingPathComponent("system-speech-\(UUID().uuidString).wav")
    try audio.write(to: url, options: .atomic)
    defer { try? FileManager.default.removeItem(at: url) }

    let request = SFSpeechURLRecognitionRequest(url: url)
    request.shouldReportPartialResults = false
    request.taskHint = .dictation
    if recognizer.supportsOnDeviceRecognition {
      request.requiresOnDeviceRecognition = true
    }

    return try await withCheckedThrowingContinuation { continuation in
      let lock = NSLock()
      var completed = false
      var task: SFSpeechRecognitionTask?

      func finish(_ result: Result<String, Error>) {
        lock.lock()
        if completed {
          lock.unlock()
          return
        }
        completed = true
        lock.unlock()
        task?.cancel()
        switch result {
        case .success(let text):
          continuation.resume(returning: text)
        case .failure(let error):
          continuation.resume(throwing: error)
        }
      }

      let timeout = DispatchWorkItem {
        finish(.failure(NSError(domain: appName, code: 122, userInfo: [NSLocalizedDescriptionKey: "系统语音识别超时"])))
      }
      DispatchQueue.global().asyncAfter(deadline: .now() + 60, execute: timeout)

      task = recognizer.recognitionTask(with: request) { result, error in
        if let error {
          timeout.cancel()
          finish(.failure(error))
          return
        }
        guard let result, result.isFinal else {
          return
        }
        timeout.cancel()
        finish(.success(result.bestTranscription.formattedString))
      }
    }
  }

  private func ensureAuthorized() async throws {
    let status = SFSpeechRecognizer.authorizationStatus()
    if status == .authorized {
      return
    }
    let next = await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { authorizationStatus in
        continuation.resume(returning: authorizationStatus)
      }
    }
    guard next == .authorized else {
      throw NSError(domain: appName, code: 123, userInfo: [NSLocalizedDescriptionKey: "SnapSay 需要「语音识别」权限才能使用系统语音识别"])
    }
  }
}

final class SnapSayLocalAsrNoticeStore: @unchecked Sendable {
  static let shared = SnapSayLocalAsrNoticeStore()
  private let lock = NSLock()
  private var notice: [String: Any]?

  func set(_ message: String) {
    let payload: [String: Any] = [
      "message": message,
      "createdAt": Int(Date().timeIntervalSince1970 * 1000)
    ]
    lock.lock()
    notice = payload
    lock.unlock()
    postAppNotification(snapsayLocalAsrRequiredNotification, object: payload)
    appLog("local asr notice set message=\(message)")
  }

  func current() -> [String: Any]? {
    lock.lock()
    defer { lock.unlock() }
    return notice
  }

  func clear() {
    lock.lock()
    let hadNotice = notice != nil
    notice = nil
    lock.unlock()
    if hadNotice {
      appLog("local asr notice cleared")
    }
  }
}

final class SnapSayRecordingPipeline: @unchecked Sendable {
  private let daemon: ASRDaemonManager
  private let asrClient: ASRDaemonClient
  private let systemAsrClient: SystemSpeechClient
  private let cloudAsrClient: CloudAsrClient
  private let settingsStore: SnapSaySettingsStore
  private let cleanupClient: CleanupClient
  private let recordStore: SnapSayRecordStore
  private let paste: PasteController

  init(
    daemon: ASRDaemonManager = ASRDaemonManager(),
    asrClient: ASRDaemonClient = ASRDaemonClient(portFile: portFile),
    systemAsrClient: SystemSpeechClient = SystemSpeechClient(),
    cloudAsrClient: CloudAsrClient = CloudAsrClient(),
    settingsStore: SnapSaySettingsStore = SnapSaySettingsStore(),
    cleanupClient: CleanupClient = CleanupClient(),
    recordStore: SnapSayRecordStore = SnapSayRecordStore(),
    paste: PasteController = PasteController()
  ) {
    self.daemon = daemon
    self.asrClient = asrClient
    self.systemAsrClient = systemAsrClient
    self.cloudAsrClient = cloudAsrClient
    self.settingsStore = settingsStore
    self.cleanupClient = cleanupClient
    self.recordStore = recordStore
    self.paste = paste
  }

  func process(
    audio: Data,
    durationMs: Int? = nil,
    pasteOutput: Bool = true,
    status: (@Sendable (String, CapsuleKind) async -> Void)? = nil
  ) async throws -> [String: Any] {
    let totalStart = Date()
    var transcript = ""
    var cleanedText: String?
    var cleanupError: String?
    var asrDurationMs: Int?
    var cleanupDurationMs: Int?
    var pasted = false
    let settings = settingsStore.load()

    do {
      appLog("recording pipeline processing bytes=\(audio.count)")
      let asrStart = Date()
      let rawText: String
      if settings.asrProfile.kind == .local {
        try daemon.ensureRunning()
        rawText = try await transcribeWithLocalRecovery(audio: audio, daemon: daemon, asrClient: asrClient).trimmingCharacters(in: .whitespacesAndNewlines)
      } else if settings.asrProfile.kind == .system {
        rawText = try await systemAsrClient.transcribe(audio: audio).trimmingCharacters(in: .whitespacesAndNewlines)
      } else {
        rawText = try await cloudAsrClient.transcribe(audio: audio, profile: settings.asrProfile).trimmingCharacters(in: .whitespacesAndNewlines)
      }
      asrDurationMs = Date().millisecondsSince(asrStart)
      transcript = stripTerminalPunctuation(settings.applyWordbook(to: rawText)).trimmingCharacters(in: .whitespacesAndNewlines)
      appLog("recording pipeline asr completed durationMs=\(asrDurationMs ?? 0) rawChars=\(rawText.count) transcriptChars=\(transcript.count)")
      guard !transcript.isEmpty else {
        throw NSError(domain: appName, code: 90, userInfo: [NSLocalizedDescriptionKey: "没有识别到文本"])
      }

      if settings.shouldCleanup(transcript: transcript) {
        await status?("文本整理", .rewriting)
        let cleanupStart = Date()
        do {
          cleanedText = try await cleanupClient.cleanup(transcript: transcript, settings: settings)
          cleanupDurationMs = Date().millisecondsSince(cleanupStart)
          appLog("recording pipeline cleanup completed durationMs=\(cleanupDurationMs ?? 0) cleanedChars=\(cleanedText?.count ?? 0)")
        } catch {
          cleanupDurationMs = Date().millisecondsSince(cleanupStart)
          cleanupError = error.localizedDescription
          appLog("cleanup failed, using transcript: \(cleanupError ?? "unknown")")
        }
      } else {
        cleanupDurationMs = 0
      }

      let output = (cleanedText?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? cleanedText : transcript) ?? transcript
      var completionStatus = "已保存"
      if pasteOutput && settings.outputAction == .paste {
        let pasteStart = Date()
        try paste.paste(text: output, restoreClipboard: false)
        pasted = true
        completionStatus = "已复制"
        appLog("paste completed characters=\(output.count) durationMs=\(Date().millisecondsSince(pasteStart))")
      } else if settings.outputAction == .copy || (!pasteOutput && settings.outputAction == .paste) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(output, forType: .string)
        completionStatus = "已复制"
        appLog("output copied without paste characters=\(output.count)")
      } else {
        appLog("output saved without clipboard characters=\(output.count)")
      }

      let recordStart = Date()
      let totalDurationMs = durationMs ?? Date().millisecondsSince(totalStart)
      let recordId = recordStore.addRecord(
        transcript: transcript,
        cleanedText: cleanedText,
        status: "completed",
        error: cleanupError,
        asrDurationMs: asrDurationMs,
        cleanupDurationMs: cleanupDurationMs,
        durationMs: totalDurationMs,
        pasteSucceeded: pasted,
        asrProvider: settings.asrProfile.recordProvider,
        asrModel: settings.asrProfile.recordModel,
        cleanupProvider: cleanedText == nil ? nil : settings.cleanupProvider?.displayName,
        cleanupModel: cleanedText == nil ? nil : settings.cleanupProvider?.model
      )
      appLog("recording pipeline completed totalMs=\(totalDurationMs) recordSaveMs=\(Date().millisecondsSince(recordStart)) pasted=\(pasted)")
      postAppNotification(snapsayRecordsChangedNotification)
      let record = recordId.flatMap { SnapSayDashboardStore().recordForRenderer(id: $0) } ?? [:]
      return ["ok": true, "text": output, "record": record, "pasted": pasted, "completionStatus": completionStatus]
    } catch {
      let nsError = error as NSError
      let recordId = recordStore.addRecord(
        transcript: transcript,
        cleanedText: cleanedText,
        status: "failed",
        error: nsError.localizedDescription,
        asrDurationMs: asrDurationMs,
        cleanupDurationMs: cleanupDurationMs,
        durationMs: durationMs ?? Date().millisecondsSince(totalStart),
        pasteSucceeded: pasted,
        asrProvider: settings.asrProfile.recordProvider,
        asrModel: settings.asrProfile.recordModel,
        cleanupProvider: cleanedText == nil ? nil : settings.cleanupProvider?.displayName,
        cleanupModel: cleanedText == nil ? nil : settings.cleanupProvider?.model
      )
      postAppNotification(snapsayRecordsChangedNotification)
      let record = recordId.flatMap { SnapSayDashboardStore().recordForRenderer(id: $0) } ?? [:]
      appLog("recording pipeline failed code=\(nsError.code) message=\(nsError.localizedDescription)")
      throw NSError(domain: appName, code: nsError.code, userInfo: [
        NSLocalizedDescriptionKey: nsError.localizedDescription,
        "record": record
      ])
    }
  }
}

@main
struct SnapSayMain {
  @MainActor private static var delegate: AppDelegate?

  @MainActor
  static func main() {
    if runCommandLineDiagnosticIfNeeded() {
      return
    }

    let application = NSApplication.shared
    let delegate = AppDelegate()
    Self.delegate = delegate
    application.delegate = delegate
    application.run()
  }

  @MainActor
  private static func runCommandLineDiagnosticIfNeeded() -> Bool {
    let arguments = CommandLine.arguments
    guard let command = arguments.dropFirst().first else {
      return false
    }

    switch command {
    case "--self-test-paste":
      let text = arguments.dropFirst(2).joined(separator: " ")
      let value = text.isEmpty ? "SnapSay paste test" : text
      do {
        try PasteController().paste(text: value, asyncRestore: false)
        print("paste-ok characters=\(value.count)")
        return true
      } catch {
        let nsError = error as NSError
        print("paste-failed code=\(nsError.code) message=\(nsError.localizedDescription)")
        return true
      }
    case "--self-test-paste-no-restore":
      let text = arguments.dropFirst(2).joined(separator: " ")
      let value = text.isEmpty ? "SnapSay paste test" : text
      do {
        try PasteController().paste(text: value, restoreClipboard: false)
        print("paste-ok characters=\(value.count)")
        return true
      } catch {
        let nsError = error as NSError
        print("paste-failed code=\(nsError.code) message=\(nsError.localizedDescription)")
        return true
      }
    case "--self-test-permissions":
      print("microphone=\(AVCaptureDevice.authorizationStatus(for: .audio).rawValue)")
      print("accessibility=\(AXIsProcessTrusted())")
      return true
    case "--self-test-settings":
      let settings = SnapSaySettingsStore().load()
      let dashboard = SnapSayDashboardStore().dashboard()
      let rendererSettings = dashboard["settings"] as? [String: Any] ?? [:]
      let providers = rendererSettings["llmProviders"] as? [[String: Any]] ?? []
      print("cleanupEnabled=\(settings.cleanupEnabled)")
      print("cleanupProvider=\(settings.cleanupProvider?.displayName ?? "none")")
      print("cleanupModel=\(settings.cleanupProvider?.model ?? "none")")
      print("llmProviders=\(providers.count)")
      print("llmProviderKeys=\(providers.compactMap { $0["key"] as? String }.joined(separator: ","))")
      print("wordbook=\(settings.wordbook.count)")
      print("hotkey=\(settings.hotKey.label)")
      print("smartMouseMode=\(settings.smartMouseMode)")
      print("mouseTrigger=\(settings.mouseTriggerLabel)")
      print("mouseButton=\(settings.mouseTrigger?.buttonNumber ?? -1)")
      print("asrProfile=\(settings.asrProfile.id)")
      print("asrKind=\(settings.asrProfile.kind.rawValue)")
      print("outputMode=\(settings.outputMode)")
      print("microphoneDeviceId=\(settings.microphoneDeviceId.isEmpty ? "default" : settings.microphoneDeviceId)")
      print("sampleWordbook=\(settings.applyWordbook(to: "口 ex 调用 ONX 模型"))")
      return true
    case "--self-test-dashboard":
      let dashboard = SnapSayDashboardStore().dashboard()
      let settings = dashboard["settings"] as? [String: Any] ?? [:]
      let records = dashboard["records"] as? [[String: Any]] ?? []
      print("dashboard-settings-trigger=\(settings["triggerKey"] as? String ?? "")")
      print("dashboard-settings-asr=\(settings["activeAsrProfileId"] as? String ?? "")")
      print("dashboard-records=\(records.count)")
      print("dashboard-first-status=\(records.first?["status"] as? String ?? "none")")
      return true
    case "--self-test-ui-bundle":
      runUiBundleSelfTest()
      return true
    case "--self-test-edit-menu":
      runEditMenuSelfTest()
      return true
    case "--self-test-json":
      runJsonSelfTest()
      return true
    case "--self-test-notifications":
      runNotificationSelfTest()
      return true
    case "--self-test-capsule":
      runCapsuleSelfTest()
      return true
    case "--self-test-bridge":
      runBridgeSelfTest()
      return true
    case "--self-test-wordbook-learning":
      runWordbookLearningSelfTest()
      return true
    case "--self-test-import-records":
      let path = arguments.dropFirst(2).joined(separator: " ")
      runImportRecordsSelfTest(path: path)
      return true
    case "--self-test-pipeline":
      runPipelineSelfTest()
      return true
    case "--self-test-submit-recording":
      runSubmitRecordingSelfTest()
      return true
    case "--self-test-cloud-asr-url":
      runCloudAsrUrlSelfTest()
      return true
    case "--self-test-output-modes":
      runOutputModesSelfTest()
      return true
    case "--self-test-audio-devices":
      runAudioDevicesSelfTest()
      return true
    case "--self-test-mouse-triggers":
      runMouseTriggersSelfTest()
      return true
    default:
      return false
    }
  }

  private static func runWordbookLearningSelfTest() {
    let chinesePairs = extractWordPairCandidates(
      original: "会议结论：优化报款逻辑与首屏性能",
      corrected: "会议结论：优化爆款逻辑与首屏性能"
    )
    let englishPairs = extractWordPairCandidates(
      original: "我今天用 cloud code 改代码",
      corrected: "我今天用 Claude Code 改代码"
    )
    let merged = mergeWordbookPairs(entries: [], pairs: chinesePairs + englishPairs)
    print("wordbook-chinese-pairs=\(jsonLiteral(chinesePairs))")
    print("wordbook-english-pairs=\(jsonLiteral(englishPairs))")
    print("wordbook-added=\(jsonLiteral(merged.addedPairs))")
    print("wordbook-count=\(merged.wordbook.count)")
  }

  private static func runImportRecordsSelfTest(path: String) {
    guard !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      print("import-records-failed missing-path")
      return
    }
    do {
      let start = Date()
      let result = try SnapSayDashboardStore().importRecordsFromFile(URL(fileURLWithPath: path))
      print("import-records-ok imported=\(result["imported"] as? Int ?? -1) updated=\(result["updated"] as? Int ?? -1) skipped=\(result["skipped"] as? Int ?? -1) wordbook=\(result["wordbookImported"] as? Int ?? -1) durationMs=\(Date().millisecondsSince(start))")
    } catch {
      print("import-records-failed message=\(error.localizedDescription)")
    }
  }

  private static func runPipelineSelfTest() {
    let sample = runtimeRoot.appendingPathComponent("tmp/asr-selftest/zh.wav")
    guard let audio = try? Data(contentsOf: sample) else {
      print("pipeline-failed missing-sample=\(sample.path)")
      return
    }
    let semaphore = DispatchSemaphore(value: 0)
    Task.detached {
      do {
        let daemon = ASRDaemonManager()
        daemon.reset()
        try daemon.ensureRunning()
        let settings = SnapSaySettingsStore().load()
        let asrStart = Date()
        let raw = try await transcribeWithLocalRecovery(audio: audio, daemon: daemon, asrClient: ASRDaemonClient(portFile: portFile))
        let asrDurationMs = Date().millisecondsSince(asrStart)
        let transcript = stripTerminalPunctuation(settings.applyWordbook(to: raw)).trimmingCharacters(in: .whitespacesAndNewlines)
        var cleanedText: String?
        var cleanupDurationMs = 0
        if settings.shouldCleanup(transcript: transcript) {
          let cleanupStart = Date()
          cleanedText = try await CleanupClient().cleanup(transcript: transcript, settings: settings)
          cleanupDurationMs = Date().millisecondsSince(cleanupStart)
        }
        _ = SnapSayRecordStore().addRecord(
          transcript: transcript,
          cleanedText: cleanedText,
          status: "completed",
          error: nil,
          asrDurationMs: asrDurationMs,
          cleanupDurationMs: cleanupDurationMs,
          durationMs: asrDurationMs + cleanupDurationMs,
          pasteSucceeded: false,
          asrProvider: settings.asrProfile.recordProvider,
          asrModel: settings.asrProfile.recordModel,
          cleanupProvider: cleanedText == nil ? nil : settings.cleanupProvider?.displayName,
          cleanupModel: cleanedText == nil ? nil : settings.cleanupProvider?.model
        )
        print("pipeline-ok transcript=\(transcript)")
      } catch {
        print("pipeline-failed message=\(error.localizedDescription)")
      }
      semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 90)
  }

  private static func runUiBundleSelfTest() {
    let bundle = Bundle.main
    let info = bundle.infoDictionary ?? [:]
    let isAgent = (info["LSUIElement"] as? Bool) == true || (info["LSUIElement"] as? String) == "1"
    print("ui-bundle-id=\(bundle.bundleIdentifier ?? "none")")
    print("ui-bundle-agent=\(isAgent)")
    guard let resourceURL = bundle.resourceURL else {
      print("ui-bundle-web=missing-resource-url")
      return
    }
    let webDir = resourceURL.appendingPathComponent("web", isDirectory: true)
    let required = ["index.html", "snapsay-main.js", "snapsay-main.css"]
    for name in required {
      let file = webDir.appendingPathComponent(name)
      print("ui-bundle-file \(name)=\(FileManager.default.fileExists(atPath: file.path))")
    }
    print("ui-bundle-icon AppIcon.icns=\(FileManager.default.fileExists(atPath: resourceURL.appendingPathComponent("AppIcon.icns").path))")
    print("ui-bundle-icon StatusIcon.png=\(FileManager.default.fileExists(atPath: resourceURL.appendingPathComponent("StatusIcon.png").path))")
    if let index = try? String(contentsOf: webDir.appendingPathComponent("index.html"), encoding: .utf8) {
      print("ui-bundle-index-snapsay=\(index.contains("snapsay-main.js") && index.contains("snapsay-main.css"))")
      print("ui-bundle-index-module=\(index.contains("type=\"module\""))")
    }
  }

  private static func runEditMenuSelfTest() {
    let editMenu = standardEditMenuItem().submenu
    let actions = editMenu?.items.compactMap { item in item.action.map(NSStringFromSelector) } ?? []
    print("edit-menu-title=\(editMenu?.title ?? "none")")
    print("edit-menu-actions=\(actions.joined(separator: ","))")
    print("edit-menu-has-paste=\(actions.contains("paste:"))")
    print("edit-menu-has-select-all=\(actions.contains("selectAll:"))")
  }

  private static func runJsonSelfTest() {
    print("json-event=\(jsonLiteral("recordsSynced", fallback: "\"failed\""))")
    print("json-payload=\(jsonLiteral(["value": NSNull(), "items": ["a", NSNull()]]))")
  }

  private static func runNotificationSelfTest() {
    let semaphore = DispatchSemaphore(value: 0)
    let token = NotificationCenter.default.addObserver(
      forName: snapsayRecordsChangedNotification,
      object: nil,
      queue: .main
    ) { _ in
      print("notification-recordsChanged-main=\(Thread.isMainThread)")
      semaphore.signal()
    }
    postAppNotification(snapsayRecordsChangedNotification)
    RunLoop.main.run(until: Date().addingTimeInterval(0.2))
    _ = semaphore.wait(timeout: .now() + 1)
    NotificationCenter.default.removeObserver(token)
  }

  @MainActor
  private static func runCapsuleSelfTest() {
    let capsule = FloatingCapsuleController()
    capsule.show(status: "已输入", kind: .done)
    capsule.show(status: "录音中", kind: .recording)
    RunLoop.main.run(until: Date().addingTimeInterval(1.7))
    print("capsule-recording-visible-after-stale-hide=\(capsule.isVisible)")
    capsule.show(status: "没有识别到文本", kind: .failed)
    RunLoop.main.run(until: Date().addingTimeInterval(1.7))
    print("capsule-failed-hidden=\(!capsule.isVisible)")
  }

  private static func runSubmitRecordingSelfTest() {
    let sample = runtimeRoot.appendingPathComponent("tmp/asr-selftest/zh.wav")
    guard let audio = try? Data(contentsOf: sample) else {
      print("submit-recording-failed missing-sample=\(sample.path)")
      return
    }
    let semaphore = DispatchSemaphore(value: 0)
    Task.detached {
      do {
        ASRDaemonManager().reset()
        let result = try await SnapSayRecordingPipeline().process(audio: audio, durationMs: 1200, pasteOutput: false)
        let text = result["text"] as? String ?? ""
        let record = result["record"] as? [String: Any] ?? [:]
        print("submit-recording-ok text=\(text)")
        print("submit-recording-record=\(record["id"] as? String ?? "")")
      } catch {
        print("submit-recording-failed message=\(error.localizedDescription)")
      }
      semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 90)
  }

  private static func runCloudAsrUrlSelfTest() {
    let bases = [
      "https://api.openai.com",
      "https://api.openai.com/v1",
      "https://example.com/custom/audio/transcriptions"
    ]
    for base in bases {
      print("cloud-asr-url \(base)=\(cloudAsrTranscriptionURL(baseUrl: base)?.absoluteString ?? "invalid")")
    }
    let wav = Data("RIFFxxxxWAVEfmt ".utf8)
    let webm = Data([0x1A, 0x45, 0xDF, 0xA3])
    print("cloud-asr-meta-wav=\(audioFileMeta(wav).contentType)")
    print("cloud-asr-meta-webm=\(audioFileMeta(webm).contentType)")
  }

  private static func runOutputModesSelfTest() {
    for mode in ["粘贴到当前光标", "复制到剪贴板", "仅保存记录"] {
      print("output-mode \(mode)=\(OutputAction.parse(mode).rawValue)")
    }
  }

  private static func runAudioDevicesSelfTest() {
    let selector = AudioInputDeviceSelector()
    let defaultId = selector.currentDefaultInputDevice()
    print("audio-default-id=\(defaultId.map(String.init) ?? "none")")
    for device in selector.inputDevices() {
      print("audio-device id=\(device.id) uid=\(device.uid) name=\(device.name)")
    }
  }

  private static func runMouseTriggersSelfTest() {
    for label in ["Mouse Middle", "Mouse Side 1", "Mouse Side 2", "Mouse X1", "鼠标侧键 1"] {
      print("mouse-trigger \(label)=\(MouseTriggerParser.parse(label: label)?.buttonNumber ?? -1)")
    }
  }

  private static func runBridgeSelfTest() {
    do {
      let store = SnapSayDashboardStore()
      let dashboard = store.dashboard()
      let records = dashboard["records"] as? [[String: Any]] ?? []
      guard let first = records.first, let id = first["id"] as? String else {
        print("bridge-ok records=0")
        return
      }
      let pairs = try store.extractWordPairs(id: id)
      let modelStatus = store.localModelStatus()
      let notice = store.localAsrNotice()
      print("bridge-record-id=\(id)")
      print("bridge-extract-ok=\((pairs["ok"] as? Bool) ?? false)")
      print("bridge-local-model-ready=\((modelStatus["ready"] as? Bool) ?? false)")
      print("bridge-local-model-installed=\((modelStatus["installed"] as? Bool) ?? false)")
      print("bridge-local-model-missing=\((modelStatus["missingFiles"] as? [String] ?? []).count)")
      print("bridge-local-asr-notice=\(notice?["message"] as? String ?? "none")")
    } catch {
      print("bridge-failed message=\(error.localizedDescription)")
    }
  }
}

final class AudioRecorder: NSObject, AVAudioRecorderDelegate {
  private var recorder: AVAudioRecorder?
  private let deviceSelector = AudioInputDeviceSelector()
  private var previousInputDevice: AudioDeviceID?

  func start(url: URL, microphoneDeviceId: String = "") throws {
    previousInputDevice = nil
    if let target = deviceSelector.resolveInputDevice(uid: microphoneDeviceId) {
      let current = deviceSelector.currentDefaultInputDevice()
      if current != target.id {
        try deviceSelector.setDefaultInputDevice(target.id)
        previousInputDevice = current
        appLog("audio input switched uid=\(target.uid) name=\(target.name)")
      } else {
        appLog("audio input already default uid=\(target.uid) name=\(target.name)")
      }
    } else if !microphoneDeviceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      appLog("audio input uid not found, using system default uid=\(microphoneDeviceId)")
    }

    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: 16_000,
      AVNumberOfChannelsKey: 1,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false
    ]
    do {
      let recorder = try AVAudioRecorder(url: url, settings: settings)
      recorder.prepareToRecord()
      recorder.record()
      self.recorder = recorder
    } catch {
      restorePreviousInputDevice()
      throw error
    }
  }

  func stop() -> URL? {
    let url = recorder?.url
    recorder?.stop()
    recorder = nil
    restorePreviousInputDevice()
    return url
  }

  private func restorePreviousInputDevice() {
    guard let previousInputDevice else { return }
    do {
      try deviceSelector.setDefaultInputDevice(previousInputDevice)
      appLog("audio input restored id=\(previousInputDevice)")
    } catch {
      appLog("audio input restore failed id=\(previousInputDevice) error=\(error.localizedDescription)")
    }
    self.previousInputDevice = nil
  }
}

struct AudioInputDevice: Sendable {
  let id: AudioDeviceID
  let uid: String
  let name: String
}

final class AudioInputDeviceSelector: @unchecked Sendable {
  private let aliasIds = Set(["", "default", "communications"])

  func resolveInputDevice(uid: String) -> AudioInputDevice? {
    let trimmed = uid.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !aliasIds.contains(trimmed.lowercased()) else { return nil }
    let devices = inputDevices()
    return devices.first { $0.uid == trimmed }
      ?? devices.first { $0.name == trimmed }
  }

  func inputDevices() -> [AudioInputDevice] {
    allAudioDevices().compactMap { id in
      guard hasInputStreams(id) else { return nil }
      return AudioInputDevice(id: id, uid: stringProperty(id, kAudioDevicePropertyDeviceUID), name: stringProperty(id, kAudioObjectPropertyName))
    }
  }

  func currentDefaultInputDevice() -> AudioDeviceID? {
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioHardwarePropertyDefaultInputDevice,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var id = AudioDeviceID()
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id)
    return status == noErr ? id : nil
  }

  func setDefaultInputDevice(_ id: AudioDeviceID) throws {
    var mutableId = id
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioHardwarePropertyDefaultInputDevice,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    let status = AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, UInt32(MemoryLayout<AudioDeviceID>.size), &mutableId)
    guard status == noErr else {
      throw NSError(domain: appName, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "无法切换系统输入设备：\(status)"])
    }
  }

  private func allAudioDevices() -> [AudioDeviceID] {
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioHardwarePropertyDevices,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else {
      return []
    }
    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var ids = [AudioDeviceID](repeating: 0, count: count)
    let status = ids.withUnsafeMutableBytes { buffer in
      AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, buffer.baseAddress!)
    }
    return status == noErr ? ids : []
  }

  private func hasInputStreams(_ id: AudioDeviceID) -> Bool {
    var address = AudioObjectPropertyAddress(
      mSelector: kAudioDevicePropertyStreams,
      mScope: kAudioDevicePropertyScopeInput,
      mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    let status = AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size)
    return status == noErr && size > 0
  }

  private func stringProperty(_ id: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String {
    var address = AudioObjectPropertyAddress(
      mSelector: selector,
      mScope: kAudioObjectPropertyScopeGlobal,
      mElement: kAudioObjectPropertyElementMain
    )
    var value: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    let status = withUnsafeMutablePointer(to: &value) { pointer in
      AudioObjectGetPropertyData(id, &address, 0, nil, &size, pointer)
    }
    return status == noErr ? value as String : ""
  }
}

final class ASRDaemonManager {
  private var process: Process?
  private let queue = DispatchQueue(label: "cn.snapsay.desktop.daemon")

  func startIfNeeded() {
    queue.async {
      do {
        try self.ensureRunning()
      } catch {
        let message = (error as NSError).localizedDescription
        appLog("daemon start failed: \(message)")
        postAppNotification(snapsayLocalAsrRequiredNotification, object: SnapSayLocalAsrNoticeStore.shared.current() ?? ["message": message])
      }
    }
  }

  func ensureRunning() throws {
    if try isPortReady() {
      return
    }
    recoverUnreachablePortIfNeeded()
    try recoverDaemonWithoutPortIfNeeded()
    if try isPortReady() {
      return
    }
    try start()
    let deadline = Date().addingTimeInterval(45)
    while Date() < deadline {
      if try isPortReady() {
        SnapSayLocalAsrNoticeStore.shared.clear()
        return
      }
      Thread.sleep(forTimeInterval: 0.2)
    }
    let message = "本地语音识别服务启动超时"
    SnapSayLocalAsrNoticeStore.shared.set(message)
    throw NSError(domain: appName, code: 30, userInfo: [NSLocalizedDescriptionKey: message])
  }

  func reset() {
    if process?.isRunning == true {
      process?.terminate()
    }
    if let pidText = try? String(contentsOf: lockFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
       let pidValue = Int32(pidText),
       pidValue > 0,
       kill(pidValue, 0) == 0 {
      appLog("reset terminating daemon pid=\(pidValue)")
      _ = kill(pidValue, SIGTERM)
      Thread.sleep(forTimeInterval: 0.5)
      if kill(pidValue, 0) == 0 {
        _ = kill(pidValue, SIGKILL)
      }
    }
    try? FileManager.default.removeItem(at: portFile)
    try? FileManager.default.removeItem(at: lockFile)
    process = nil
  }

  private func recoverUnreachablePortIfNeeded() {
    guard FileManager.default.fileExists(atPath: portFile.path) else {
      return
    }
    appLog("daemon port exists but is not reachable, clearing stale daemon state")
    try? FileManager.default.removeItem(at: portFile)
    if let pidText = try? String(contentsOf: lockFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
       let pidValue = Int32(pidText),
       pidValue > 0 {
      if kill(pidValue, 0) == 0 {
        appLog("terminating daemon with stale port pid=\(pidValue)")
        _ = kill(pidValue, SIGTERM)
      } else {
        appLog("removing stale daemon lock pid=\(pidValue)")
      }
    }
    try? FileManager.default.removeItem(at: lockFile)
  }

  private func recoverDaemonWithoutPortIfNeeded() throws {
    guard FileManager.default.fileExists(atPath: lockFile.path),
          !FileManager.default.fileExists(atPath: portFile.path),
          let pidText = try? String(contentsOf: lockFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
          let pidValue = Int32(pidText),
          pidValue > 0 else {
      return
    }

    appLog("daemon lock exists without port pid=\(pidValue), waiting for recovery")
    let waitDeadline = Date().addingTimeInterval(8)
    while Date() < waitDeadline {
      if try isPortReady() {
        return
      }
      Thread.sleep(forTimeInterval: 0.25)
    }

    if kill(pidValue, 0) == 0 {
      appLog("terminating daemon without discoverable port pid=\(pidValue)")
      _ = kill(pidValue, SIGTERM)
      let terminationDeadline = Date().addingTimeInterval(3)
      while Date() < terminationDeadline {
        if kill(pidValue, 0) != 0 {
          break
        }
        Thread.sleep(forTimeInterval: 0.2)
      }
      if kill(pidValue, 0) == 0 {
        appLog("force terminating daemon without discoverable port pid=\(pidValue)")
        _ = kill(pidValue, SIGKILL)
      }
    }
    try? FileManager.default.removeItem(at: lockFile)
    try? FileManager.default.removeItem(at: portFile)
  }

  private func start() throws {
    appLog("daemon start requested python=\(pythonPath.path) model=\(modelDir.path)")
    guard localAsrRuntimeReady() else {
      let message = "本地语音运行环境未安装。请打开「模型」页面点击「下载模型」，SnapSay 会安装运行环境并下载模型。缺少：\(pythonPath.path)"
      SnapSayLocalAsrNoticeStore.shared.set(message)
      throw NSError(domain: appName, code: 31, userInfo: [NSLocalizedDescriptionKey: message])
    }
    guard FileManager.default.fileExists(atPath: modelDir.appendingPathComponent("model.onnx").path) else {
      let message = "本地语音模型未安装。请打开「模型」页面，点击「下载模型」后再录音。缺少文件：model.onnx"
      SnapSayLocalAsrNoticeStore.shared.set(message)
      throw NSError(domain: appName, code: 32, userInfo: [NSLocalizedDescriptionKey: message])
    }
    guard let script = Bundle.main.resourceURL?.appendingPathComponent("asr-daemon-onnx.py"),
          FileManager.default.fileExists(atPath: script.path) else {
      let message = "SnapSay 缺少 ASR daemon 脚本"
      SnapSayLocalAsrNoticeStore.shared.set(message)
      throw NSError(domain: appName, code: 33, userInfo: [NSLocalizedDescriptionKey: message])
    }
    appLog("daemon script=\(script.path)")

    if process?.isRunning == true {
      return
    }
    try? FileManager.default.removeItem(at: portFile)

    let outLog = logsDir.appendingPathComponent("snapsay-asr-daemon.out.log")
    let errLog = logsDir.appendingPathComponent("snapsay-asr-daemon.err.log")
    FileManager.default.createFile(atPath: outLog.path, contents: nil)
    FileManager.default.createFile(atPath: errLog.path, contents: nil)
    let outHandle = try FileHandle(forWritingTo: outLog)
    let errHandle = try FileHandle(forWritingTo: errLog)
    outHandle.seekToEndOfFile()
    errHandle.seekToEndOfFile()

    let process = Process()
    process.executableURL = pythonPath
    process.arguments = [script.path]
    process.environment = ProcessInfo.processInfo.environment.merging([
      "SNAPSAY_ROOT": runtimeRoot.path,
      "ASR_MODEL_PATH": modelDir.path,
      "ASR_PORT_FILE": portFile.path,
      "ASR_TMP_DIR": tempDir.path,
      "ASR_LOCK_FILE": lockFile.path,
      "ASR_PARENT_PID": "\(getpid())",
      "ASR_IDLE_TIMEOUT_SECONDS": "600",
      "HF_HOME": runtimeRoot.appendingPathComponent("cache/huggingface").path,
      "PIP_CACHE_DIR": runtimeRoot.appendingPathComponent("cache/pip").path
    ]) { _, new in new }
    process.standardOutput = outHandle
    process.standardError = errHandle
    process.terminationHandler = { _ in
      try? outHandle.close()
      try? errHandle.close()
    }
    try process.run()
    self.process = process
    appLog("daemon process started pid=\(process.processIdentifier)")
  }

  private func isPortReady() throws -> Bool {
    guard FileManager.default.fileExists(atPath: portFile.path),
          let text = try? String(contentsOf: portFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
          let port = UInt32(text) else {
      return false
    }
    return canConnect(port: port)
  }

  private func canConnect(port: UInt32) -> Bool {
    let descriptor = socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else {
      return false
    }
    defer { close(descriptor) }

    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = UInt16(port).bigEndian
    guard inet_pton(AF_INET, "127.0.0.1", &address.sin_addr) == 1 else {
      return false
    }

    let result = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
        connect(descriptor, socketAddress, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    return result == 0
  }
}

enum CapsuleKind: Sendable {
  case recording
  case recognizing
  case rewriting
  case done
  case failed
}

@MainActor
final class FloatingCapsuleController {
  private let panel: NSPanel
  private let capsuleView: CapsuleView
  private var hideWorkItem: DispatchWorkItem?
  private var hasPositioned = false

  var isVisible: Bool {
    panel.isVisible
  }

  init() {
    panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 118, height: 28), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    capsuleView = CapsuleView(frame: panel.contentView?.bounds ?? NSRect(x: 0, y: 0, width: 118, height: 28))
    panel.isFloatingPanel = true
    panel.level = .screenSaver
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = false
    panel.ignoresMouseEvents = false
    panel.isMovableByWindowBackground = false

    let view = capsuleView
    view.autoresizingMask = [.width, .height]
    view.onDragStarted = { [weak self] in
      self?.hideWorkItem?.cancel()
      self?.hideWorkItem = nil
    }
    view.onDragChanged = { [weak self] origin in
      self?.panel.setFrameOrigin(origin)
      self?.hasPositioned = true
    }
    view.onDragEnded = { [weak self] in
      self?.clampToVisibleScreens()
      self?.savePosition()
    }
    panel.contentView = view
  }

  func show(status: String, kind: CapsuleKind) {
    hideWorkItem?.cancel()
    hideWorkItem = nil
    resize(for: status)
    capsuleView.status = status
    capsuleView.kind = kind
    capsuleView.needsDisplay = true
    positionIfNeeded()
    panel.orderFrontRegardless()
    if kind == .done || kind == .failed {
      let workItem = DispatchWorkItem { [weak self] in
        self?.panel.orderOut(nil)
        self?.hideWorkItem = nil
      }
      hideWorkItem = workItem
      DispatchQueue.main.asyncAfter(deadline: .now() + (kind == .done ? 0.65 : 1.5), execute: workItem)
    }
  }

  private func resize(for status: String) {
    let preserveCenter = hasPositioned
    let center = NSPoint(x: panel.frame.midX, y: panel.frame.midY)
    let textWidth = ceil(CapsuleView.textSize(for: status).width) + 4
    let waveWidth: CGFloat = 30
    let spacing: CGFloat = 8
    let horizontalPadding: CGFloat = 24
    let contentWidth = textWidth + spacing + waveWidth
    let width = min(max(contentWidth + horizontalPadding, 118), 220)
    let size = NSSize(width: width, height: 28)
    panel.setContentSize(size)
    capsuleView.frame = NSRect(origin: .zero, size: size)
    if preserveCenter {
      panel.setFrameOrigin(NSPoint(x: center.x - size.width / 2, y: center.y - size.height / 2))
      clampToVisibleScreens()
    }
    let startX = floor((width - contentWidth) / 2)
    capsuleView.textRect = NSRect(x: startX, y: 0, width: textWidth, height: size.height)
    capsuleView.waveStartX = capsuleView.textRect.maxX + spacing
    capsuleView.waveWidth = waveWidth
  }

  private func positionIfNeeded() {
    guard !hasPositioned else {
      clampToVisibleScreens()
      return
    }
    if let saved = loadPosition() {
      panel.setFrameOrigin(saved)
      clampToVisibleScreens()
      hasPositioned = true
      return
    }
    let mouse = NSEvent.mouseLocation
    let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
    guard let frame = screen?.visibleFrame else { return }
    let size = panel.frame.size
    panel.setFrameOrigin(NSPoint(x: frame.midX - size.width / 2, y: frame.minY + 36))
    hasPositioned = true
  }

  private func clampToVisibleScreens() {
    guard let screenFrame = visibleFrameForCurrentPanel() else { return }
    let size = panel.frame.size
    let margin: CGFloat = 6
    let minX = screenFrame.minX + margin
    let maxX = screenFrame.maxX - size.width - margin
    let minY = screenFrame.minY + margin
    let maxY = screenFrame.maxY - size.height - margin
    let x = min(max(panel.frame.origin.x, minX), max(minX, maxX))
    let y = min(max(panel.frame.origin.y, minY), max(minY, maxY))
    panel.setFrameOrigin(NSPoint(x: x, y: y))
  }

  private func visibleFrameForCurrentPanel() -> NSRect? {
    let center = NSPoint(x: panel.frame.midX, y: panel.frame.midY)
    if let screen = NSScreen.screens.first(where: { $0.frame.contains(center) }) {
      return screen.visibleFrame
    }
    if let screen = NSScreen.screens.first(where: { $0.frame.intersects(panel.frame) }) {
      return screen.visibleFrame
    }
    return NSScreen.main?.visibleFrame
  }

  private func loadPosition() -> NSPoint? {
    guard let data = try? Data(contentsOf: capsulePositionFile),
          let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let x = root["x"] as? Double,
          let y = root["y"] as? Double else {
      return nil
    }
    return NSPoint(x: x, y: y)
  }

  private func savePosition() {
    try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
    let root: [String: Any] = [
      "x": Double(panel.frame.origin.x),
      "y": Double(panel.frame.origin.y),
      "updatedAt": ISO8601DateFormatter().string(from: Date())
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys]) else {
      return
    }
    do {
      try data.write(to: capsulePositionFile)
      appLog("capsule position saved x=\(Int(panel.frame.origin.x)) y=\(Int(panel.frame.origin.y))")
    } catch {
      appLog("capsule position save failed: \(error.localizedDescription)")
    }
  }
}

final class CapsuleView: NSView {
  var kind: CapsuleKind = .recording
  var status = ""
  var textRect = NSRect(x: 12, y: 0, width: 48, height: 28)
  var waveStartX: CGFloat = 90
  var waveWidth: CGFloat = 38
  var onDragStarted: (() -> Void)?
  var onDragChanged: ((NSPoint) -> Void)?
  var onDragEnded: (() -> Void)?
  private var dragStartMouse: NSPoint?
  private var dragStartOrigin: NSPoint?
  private var wavePhase = 0
  private var timer: Timer?
  private static let statusFont = NSFont.systemFont(ofSize: 11, weight: .bold)

  override var acceptsFirstResponder: Bool { true }

  override func mouseDown(with event: NSEvent) {
    dragStartMouse = NSEvent.mouseLocation
    dragStartOrigin = window?.frame.origin
    onDragStarted?()
  }

  override func mouseDragged(with event: NSEvent) {
    guard let dragStartMouse,
          let dragStartOrigin else {
      return
    }
    let mouse = NSEvent.mouseLocation
    onDragChanged?(NSPoint(
      x: dragStartOrigin.x + mouse.x - dragStartMouse.x,
      y: dragStartOrigin.y + mouse.y - dragStartMouse.y
    ))
  }

  override func mouseUp(with event: NSEvent) {
    dragStartMouse = nil
    dragStartOrigin = nil
    onDragEnded?()
  }

  static func textSize(for status: String) -> NSSize {
    let attributes: [NSAttributedString.Key: Any] = [.font: statusFont]
    return (status as NSString).boundingRect(
      with: NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude),
      options: [.usesLineFragmentOrigin, .usesFontLeading],
      attributes: attributes
    ).size
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil {
      startAnimation()
    } else {
      timer?.invalidate()
      timer = nil
    }
  }

  override func draw(_ dirtyRect: NSRect) {
    let colors: (NSColor, NSColor, NSColor)
    switch kind {
    case .recording, .recognizing, .rewriting, .done:
      colors = (NSColor(hex: 0x2EA66A), NSColor(hex: 0x22975D), NSColor.white.withAlphaComponent(0.16))
    case .failed:
      colors = (NSColor(hex: 0xC83B31), NSColor(hex: 0xA72F27), NSColor.white.withAlphaComponent(0.16))
    }
    let rect = bounds.insetBy(dx: 1, dy: 1)
    let path = rect.roundedPath(radius: 17)
    NSGraphicsContext.saveGraphicsState()
    path.addClip()
    NSGradient(starting: colors.0, ending: colors.1)?.draw(in: rect, angle: 135)
    NSGraphicsContext.restoreGraphicsState()

    colors.2.setStroke()
    path.lineWidth = 1
    path.stroke()
    drawStatus(in: rect)
    drawWave(in: rect)
  }

  private func drawStatus(in rect: NSRect) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byClipping
    paragraph.alignment = .left
    let attributes: [NSAttributedString.Key: Any] = [
      .font: Self.statusFont,
      .foregroundColor: NSColor.white,
      .paragraphStyle: paragraph
    ]
    let measured = (status as NSString).boundingRect(
      with: NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude),
      options: [.usesLineFragmentOrigin, .usesFontLeading],
      attributes: attributes
    )
    let y = floor(rect.midY - measured.height / 2)
    let drawRect = NSRect(x: textRect.minX, y: y, width: textRect.width, height: ceil(measured.height))
    (status as NSString).draw(with: drawRect, options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes)
  }

  private func drawWave(in rect: NSRect) {
    let active = kind == .recording || kind == .recognizing || kind == .rewriting
    let barCount = 6
    let barWidth: CGFloat = 2.5
    let gap = max((waveWidth - CGFloat(barCount) * barWidth) / CGFloat(barCount - 1), 2.5)
    let baseX = min(max(waveStartX, rect.minX + 10), rect.maxX - waveWidth - 10)
    let midY = rect.midY
    let heights: [CGFloat] = active
      ? (0..<barCount).map { index in
        let reversedIndex = barCount - 1 - index
        let value = sin((CGFloat(wavePhase + reversedIndex * 2) / 10.0) * .pi)
        return 4 + max(0, value) * 10
      }
      : Array(repeating: 3, count: barCount)
    NSColor.white.withAlphaComponent(active ? 0.88 : 0.45).setFill()
    for (index, height) in heights.enumerated() {
      let x = baseX + CGFloat(index) * (barWidth + gap)
      NSBezierPath(roundedRect: NSRect(x: x, y: midY - height / 2, width: barWidth, height: height), xRadius: 1.5, yRadius: 1.5).fill()
    }
  }

  private func startAnimation() {
    guard timer == nil else { return }
    timer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
      guard let self else { return }
      wavePhase = (wavePhase + 1) % 1000
      if kind == .recording || kind == .recognizing || kind == .rewriting {
        needsDisplay = true
      }
    }
  }
}

private extension NSRect {
  func roundedPath(radius: CGFloat) -> NSBezierPath {
    NSBezierPath(roundedRect: self, xRadius: radius, yRadius: radius)
  }
}

private extension CGEventFlags {
  func match(carbonModifiers: UInt32) -> Bool {
    let required: [(UInt32, CGEventFlags)] = [
      (UInt32(optionKey), .maskAlternate),
      (UInt32(cmdKey), .maskCommand),
      (UInt32(controlKey), .maskControl),
      (UInt32(shiftKey), .maskShift)
    ]
    for (carbon, flag) in required {
      let shouldContain = (carbonModifiers & carbon) != 0
      if contains(flag) != shouldContain {
        return false
      }
    }
    return true
  }
}

private extension NSColor {
  convenience init(hex: UInt32) {
    self.init(
      calibratedRed: CGFloat((hex >> 16) & 0xff) / 255.0,
      green: CGFloat((hex >> 8) & 0xff) / 255.0,
      blue: CGFloat(hex & 0xff) / 255.0,
      alpha: 1
    )
  }
}

@MainActor
final class MainWindowController: NSObject, WKScriptMessageHandler, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
  private let window: NSWindow
  private let webView: WKWebView
  private let bridge = SnapSayWebBridge()

  override init() {
    let contentController = WKUserContentController()
    let configuration = WKWebViewConfiguration()
    configuration.userContentController = contentController
    configuration.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
    configuration.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
    webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1120, height: 760), configuration: configuration)
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1120, height: 760),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    super.init()
    contentController.addUserScript(WKUserScript(source: Self.diagnosticScript, injectionTime: .atDocumentStart, forMainFrameOnly: false))
    contentController.addUserScript(WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    contentController.add(self, name: "snapsayBridge")
    contentController.addScriptMessageHandler(self, contentWorld: .page, name: "snapsayBridgeReply")
    contentController.add(self, name: "snapsayLog")
    webView.navigationDelegate = self
    NotificationCenter.default.addObserver(self, selector: #selector(recordsChanged), name: snapsayRecordsChangedNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(handleWindowControl(_:)), name: snapsayWindowControlNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(localAsrRequired(_:)), name: snapsayLocalAsrRequiredNotification, object: nil)
    window.title = "SnapSay"
    window.center()
    window.contentView = webView
    window.isReleasedWhenClosed = false
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  func show() {
    loadIfNeeded()
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
    NSApp.activate(ignoringOtherApps: true)
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    if message.name == "snapsayLog" {
      appLog("web \(message.body)")
      return
    }

    guard let body = message.body as? [String: Any],
          let id = body["id"] as? String,
          let method = body["method"] as? String else {
      return
    }
    let args = body["args"] as? [Any] ?? []
    Task { [self, bridge] in
      do {
        let result = try await bridge.handle(method: method, args: args)
        appLog("web bridge responding method=\(method) id=\(id)")
        self.resolve(id: id, result: result)
      } catch {
        appLog("web bridge rejecting method=\(method) id=\(id) error=\(error.localizedDescription)")
        self.reject(id: id, error: error.localizedDescription)
      }
    }
  }

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage,
    replyHandler: @escaping (Any?, String?) -> Void
  ) {
    guard let body = message.body as? [String: Any],
          let method = body["method"] as? String else {
      replyHandler(nil, "Invalid native bridge message")
      return
    }
    let args = body["args"] as? [Any] ?? []
    Task { [bridge] in
      do {
        let result = try await bridge.handle(method: method, args: args)
        replyHandler(result, nil)
      } catch {
        replyHandler(nil, error.localizedDescription)
      }
    }
  }

  private func loadIfNeeded() {
    guard webView.url == nil else { return }
    if let url = Bundle.main.resourceURL?.appendingPathComponent("web/index.html"),
       FileManager.default.fileExists(atPath: url.path) {
      appLog("web ui loading file=\(url.path)")
      webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    } else {
      appLog("web ui missing bundled index")
      webView.loadHTMLString("<h1>SnapSay UI not bundled</h1><p>Missing Resources/web/index.html</p>", baseURL: nil)
    }
  }

  nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    appLog("web ui did finish")
    Task { @MainActor [weak self] in
      if let notice = SnapSayDashboardStore().localAsrNotice() {
        self?.emit(event: "localAsrRequired", payload: notice)
      }
    }
  }

  nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    appLog("web ui did fail error=\(error.localizedDescription)")
  }

  nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    appLog("web ui did fail provisional error=\(error.localizedDescription)")
  }

  private func resolve(id: String, result: Any) {
    evaluateCallback(name: "__snapsayResolve", id: id, payload: result)
  }

  private func reject(id: String, error: String) {
    evaluateCallback(name: "__snapsayReject", id: id, payload: ["message": error])
  }

  private func evaluateCallback(name: String, id: String, payload: Any) {
    let json = jsonLiteral(payload)
    let jsonData = Data(json.utf8)
    let jsonBase64 = jsonData.base64EncodedString()
    let idJson = jsonLiteral(id, fallback: "\"\"")
    let base64Json = jsonLiteral(jsonBase64, fallback: "\"\"")
    let script = """
    (() => {
      const binary = atob(\(base64Json));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      window.\(name)(\(idJson), JSON.parse(new TextDecoder().decode(bytes)));
    })();
    """
    DispatchQueue.main.async { [webView] in
      webView.evaluateJavaScript(script) { _, error in
        if let error {
          appLog("web callback failed callback=\(name) bytes=\(json.count) error=\(error.localizedDescription)")
        } else {
          appLog("web callback delivered callback=\(name) id=\(id) bytes=\(json.count)")
        }
      }
    }
  }

  @objc private func recordsChanged() {
    sendRecordsSynced()
  }

  @objc private func localAsrRequired(_ notification: Notification) {
    emit(event: "localAsrRequired", payload: notification.object as? [String: Any] ?? [:])
  }

  @objc private func handleWindowControl(_ notification: Notification) {
    guard let action = notification.object as? String else { return }
    switch action {
    case "minimize":
      window.miniaturize(nil)
    case "toggle-maximize":
      window.isZoomed ? window.zoom(nil) : window.zoom(nil)
    case "close":
      window.close()
    default:
      break
    }
  }

  func sendRecordsSynced() {
    let records = SnapSayDashboardStore().dashboard()["records"] as? [[String: Any]] ?? []
    emit(event: "recordsSynced", payload: records)
  }

  private func emit(event: String, payload: Any) {
    let json = jsonLiteral(payload)
    let eventJson = jsonLiteral(event, fallback: "\"\"")
    webView.evaluateJavaScript("window.__snapsayEmit(\(eventJson), \(json));") { _, error in
      if let error {
        appLog("web emit failed event=\(event): \(error.localizedDescription)")
      }
    }
  }

  private static let diagnosticScript = """
  (() => {
    const post = (level, values) => {
      try {
        window.webkit?.messageHandlers?.snapsayLog?.postMessage({
          level,
          values: Array.from(values || []).map((value) => {
            if (value instanceof Error) return value.stack || value.message;
            if (typeof value === 'object') {
              try { return JSON.stringify(value); } catch { return String(value); }
            }
            return String(value);
          })
        });
      } catch {}
    };
    const originalError = console.error;
    console.error = (...args) => {
      post('console.error', args);
      originalError.apply(console, args);
    };
    window.addEventListener('error', (event) => {
      post('error', [event.message, event.filename, event.lineno, event.colno, event.error]);
    });
    window.addEventListener('unhandledrejection', (event) => {
      post('unhandledrejection', [event.reason]);
    });
  })();
  """

  private static let bridgeScript = """
  (() => {
    const pending = new Map();
    let seq = 1;
    window.__snapsayResolve = (id, value) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.resolve(value);
    };
    window.__snapsayReject = (id, error) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.reject(new Error(error && error.message ? error.message : String(error)));
    };
    const call = (method, args) => {
      const replyBridge = window.webkit?.messageHandlers?.snapsayBridgeReply;
      if (replyBridge?.postMessage) {
        return replyBridge.postMessage({ method, args });
      }
      return new Promise((resolve, reject) => {
        const id = String(seq++);
        pending.set(id, { resolve, reject });
        window.webkit.messageHandlers.snapsayBridge.postMessage({ id, method, args });
      });
    };
    const listeners = new Map();
    const on = (event, callback) => {
      const list = listeners.get(event) || [];
      list.push(callback);
      listeners.set(event, list);
      return () => listeners.set(event, (listeners.get(event) || []).filter((item) => item !== callback));
    };
    window.__snapsayEmit = (event, payload) => {
      for (const callback of listeners.get(event) || []) {
        try { callback(payload); } catch (error) { console.error(error); }
      }
    };
    const syncRecords = async () => {
      const dashboard = await call('getDashboard', []);
      window.__snapsayEmit('recordsSynced', dashboard.records || []);
      return dashboard;
    };
    const callAndSync = async (method, args) => {
      const result = await call(method, args);
      await syncRecords();
      return result;
    };
    window.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key && event.key.toLowerCase() === 'q') {
        event.preventDefault();
        event.stopPropagation();
        void call('quitApp', []);
      }
    }, true);
    const audioToBase64 = async (audio) => {
      let buffer = audio;
      if (audio instanceof Blob) {
        buffer = await audio.arrayBuffer();
      } else if (ArrayBuffer.isView(audio)) {
        buffer = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
      }
      if (!(buffer instanceof ArrayBuffer)) {
        throw new Error('录音数据格式不支持');
      }
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      let binary = '';
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
      }
      return btoa(binary);
    };
    window.snapsay = {
      getDashboard: () => call('getDashboard', []),
      submitRecording: async (audio, durationMs) => {
        const result = await call('submitRecording', [await audioToBase64(audio), durationMs || null]);
        if (result && result.record) {
          window.__snapsayEmit('recordAdded', result.record);
        }
        await syncRecords();
        return result;
      },
      saveSettings: (settings) => call('saveSettings', [settings]),
      copyText: (text) => call('copyText', [text]),
      rewriteRecord: (id) => callAndSync('rewriteRecord', [id]),
      pasteRecord: (id) => call('pasteRecord', [id]),
      deleteRecord: async (id) => {
        const result = await call('deleteRecord', [id]);
        window.__snapsayEmit('recordDeleted', id);
        await syncRecords();
        return result;
      },
      clearAllRecords: async () => {
        const result = await call('clearAllRecords', []);
        window.__snapsayEmit('recordsCleared');
        return result;
      },
      clearDiagnosticLogs: () => callAndSync('clearDiagnosticLogs', []),
      exportRecords: () => call('exportRecords', []),
      importRecords: () => callAndSync('importRecords', []),
      exportWordbook: () => call('exportWordbook', []),
      importWordbook: (async () => {
        const result = await call('importWordbook', []);
        const dashboard = await call('getDashboard', []);
        window.__snapsayEmit('recordsSynced', dashboard.records || []);
        return result;
      }),
      saveWordbook: (wordbook) => call('saveWordbook', [wordbook]),
      saveCorrection: (id, text) => callAndSync('saveCorrection', [id, text]),
      extractWordPairs: (id) => call('extractWordPairs', [id]),
      testRewriteApi: (settings) => call('testRewriteApi', [settings]),
      downloadLocalModel: () => call('downloadLocalModel', []),
      openLocalModelDir: () => call('openLocalModelDir', []),
      quitApp: () => call('quitApp', []),
      windowControl: (action) => call('windowControl', [action]),
      openExternal: (url) => call('openExternal', [url]),
      getLocalModelStatus: () => call('getLocalModelStatus', []),
      getLocalAsrNotice: () => call('getLocalAsrNotice', []),
      clearLocalAsrNotice: () => call('clearLocalAsrNotice', []),
      onRecordAdded: (callback) => on('recordAdded', callback),
      onRecordUpdated: (callback) => on('recordUpdated', callback),
      onRecordDeleted: (callback) => on('recordDeleted', callback),
      onRecordsCleared: (callback) => on('recordsCleared', callback),
      onRecordsSynced: (callback) => on('recordsSynced', callback),
      onLocalAsrRequired: (callback) => on('localAsrRequired', callback),
      onRecordingStart: (callback) => on('recordingStart', callback),
      onRecordingStop: (callback) => on('recordingStop', callback),
      onRequestMicrophoneAccess: (callback) => on('requestMicrophoneAccess', callback),
      reportMicrophonePermissionResult: (result) => call('reportMicrophonePermissionResult', [result]),
      reportRecordingError: (message) => callAndSync('reportRecordingError', [message])
    };
  })();
  """
}

final class SnapSayWebBridge: @unchecked Sendable {
  private let settingsStore = SnapSaySettingsStore()
  private let dashboardStore = SnapSayDashboardStore()
  private let recordStore = SnapSayRecordStore()

  func handle(method: String, args: [Any]) async throws -> Any {
    switch method {
    case "getDashboard":
      let dashboard = dashboardStore.dashboard()
      let settings = dashboard["settings"] as? [String: Any] ?? [:]
      appLog("web bridge getDashboard trigger=\(settings["triggerKey"] as? String ?? "") records=\((dashboard["records"] as? [[String: Any]])?.count ?? 0)")
      return dashboard
    case "submitRecording":
      guard let base64 = args.first as? String,
            let audio = Data(base64Encoded: base64) else {
        return ["ok": false, "message": "录音数据为空"]
      }
      let durationValue = args.dropFirst().first
      let durationMs = (durationValue as? NSNumber)?.intValue ?? durationValue as? Int
      return try await SnapSayRecordingPipeline(recordStore: recordStore).process(audio: audio, durationMs: durationMs)
    case "reportRecordingError":
      let message = (args.first as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
      let id = recordStore.addRecord(
        transcript: "",
        cleanedText: nil,
        status: "failed",
        error: message?.isEmpty == false ? message : "录音失败",
        asrDurationMs: nil,
        cleanupDurationMs: nil,
        durationMs: nil,
        pasteSucceeded: false,
        asrProvider: nil,
        asrModel: nil,
        cleanupProvider: nil,
        cleanupModel: nil
      )
      postAppNotification(snapsayRecordsChangedNotification)
      return ["ok": true, "record": id.flatMap { dashboardStore.recordForRenderer(id: $0) } ?? [:]]
    case "saveSettings":
      guard let settings = args.first as? [String: Any] else { return ["ok": false] }
      try dashboardStore.saveRendererSettings(settings)
      return settings
    case "copyText":
      let text = args.first as? String ?? ""
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
      return ["ok": true]
    case "pasteRecord":
      guard let id = args.first as? String else { return ["ok": false, "message": "记录不存在"] }
      return try dashboardStore.pasteRecord(id: id)
    case "rewriteRecord":
      guard let id = args.first as? String else { return ["ok": false, "message": "记录不存在"] }
      return try await dashboardStore.rewriteRecord(id: id)
    case "deleteRecord":
      if let id = args.first as? String {
        try dashboardStore.deleteRecord(id: id)
      }
      return ["ok": true]
    case "clearAllRecords":
      try dashboardStore.clearAllRecords()
      return ["ok": true]
    case "clearDiagnosticLogs":
      return try dashboardStore.clearDiagnosticLogs()
    case "exportRecords":
      return try await dashboardStore.exportRecords()
    case "importRecords":
      return try await dashboardStore.importRecords()
    case "exportWordbook":
      return try await dashboardStore.exportWordbook()
    case "importWordbook":
      return try await dashboardStore.importWordbook()
    case "saveWordbook":
      let wordbook = args.first as? [[String: Any]] ?? []
      try dashboardStore.saveWordbook(wordbook)
      return ["ok": true, "wordbook": wordbook]
    case "saveCorrection":
      let id = args.first as? String ?? ""
      let correction = args.dropFirst().first as? String ?? ""
      return try dashboardStore.saveCorrection(id: id, correctionText: correction)
    case "extractWordPairs":
      let id = args.first as? String ?? ""
      return try dashboardStore.extractWordPairs(id: id)
    case "testRewriteApi":
      let settings = args.first as? [String: Any]
      return try await dashboardStore.testRewriteApi(rendererSettings: settings)
    case "downloadLocalModel":
      return try await dashboardStore.downloadLocalModel()
    case "openLocalModelDir":
      try FileManager.default.createDirectory(at: modelDir, withIntermediateDirectories: true)
      let opened = NSWorkspace.shared.open(modelDir)
      appLog("open local model dir opened=\(opened) path=\(modelDir.path)")
      return ["ok": opened, "path": modelDir.path]
    case "getLocalModelStatus":
      return dashboardStore.localModelStatus()
    case "getLocalAsrNotice":
      return dashboardStore.localAsrNotice() ?? NSNull()
    case "clearLocalAsrNotice":
      SnapSayLocalAsrNoticeStore.shared.clear()
      return ["ok": true]
    case "reportMicrophonePermissionResult":
      let payload = args.first.map { String(describing: $0) } ?? "nil"
      appLog("renderer microphone permission result=\(payload)")
      return ["ok": true]
    case "windowControl":
      let action = args.first as? String ?? ""
      postAppNotification(snapsayWindowControlNotification, object: action)
      return ["ok": true]
    case "quitApp":
      await MainActor.run { NSApp.terminate(nil) }
      return ["ok": true]
    case "openExternal":
      if let text = args.first as? String, let url = URL(string: text) {
        _ = await MainActor.run { NSWorkspace.shared.open(url) }
      }
      return ["ok": true]
    default:
      appLog("web bridge unsupported method=\(method)")
      return ["ok": false, "message": "暂未迁移此功能：\(method)"]
    }
  }
}

struct SnapSaySettings: Sendable {
  var cleanupEnabled = false
  var cleanupPrompt = defaultCleanupPrompt
  var cleanupProvider: CleanupProvider?
  var wordbook: [WordbookEntry] = []
  var hotKey = HotKeyConfig.default
  var asrProfile = AsrProfile.local
  var outputMode = "粘贴到当前光标"
  var microphoneDeviceId = ""
  var shortPressAction = "语音输入"
  var longPressAction = "语音助手"
  var smartMouseMode = true
  var mouseTriggerLabel = "Mouse Middle"
  var mouseTrigger: MouseTriggerConfig? = MouseTriggerConfig.default

  func applyWordbook(to text: String) -> String {
    wordbook.reduce(text) { current, entry in
      entry.variants.reduce(current) { result, variant in
        guard !variant.isEmpty else { return result }
        return result.replacingOccurrences(of: variant, with: entry.target, options: [.caseInsensitive, .diacriticInsensitive])
      }
    }
  }

  func shouldCleanup(transcript: String) -> Bool {
    cleanupEnabled && cleanupProvider != nil && countEffectiveChars(transcript) > cleanupMinEffectiveChars
  }

  var outputAction: OutputAction {
    OutputAction.parse(outputMode)
  }
}

enum OutputAction: String, Sendable {
  case paste
  case copy
  case saveOnly

  static func parse(_ value: String) -> OutputAction {
    if value.contains("仅保存") {
      return .saveOnly
    }
    if value.contains("复制") {
      return .copy
    }
    return .paste
  }
}

struct CleanupProvider: Sendable {
  let displayName: String
  let baseUrl: String
  let apiKey: String
  let model: String
}

struct WordbookEntry: Sendable {
  let target: String
  let variants: [String]
}

struct HotKeyConfig: Sendable {
  let label: String
  let keyCode: UInt32
  let modifiers: UInt32

  static let `default` = HotKeyConfig(label: "Option + 2", keyCode: UInt32(kVK_ANSI_2), modifiers: UInt32(optionKey))
}

struct MouseTriggerConfig: Sendable {
  let label: String
  let buttonNumber: Int

  static let `default` = MouseTriggerConfig(label: "Mouse Middle", buttonNumber: 2)
}

enum MouseTriggerParser {
  static func parse(label: String) -> MouseTriggerConfig? {
    let normalized = label.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    switch normalized {
    case "mouse middle", "middle", "中键", "鼠标中键":
      return MouseTriggerConfig(label: label, buttonNumber: 2)
    case "mouse x1", "mouse side 1", "x1", "side 1", "button4", "mouse button 4", "鼠标侧键1", "鼠标侧键 1", "侧键1", "侧键 1":
      return MouseTriggerConfig(label: label, buttonNumber: 3)
    case "mouse x2", "mouse side 2", "x2", "side 2", "button5", "mouse button 5", "鼠标侧键2", "鼠标侧键 2", "侧键2", "侧键 2":
      return MouseTriggerConfig(label: label, buttonNumber: 4)
    case "mouse left", "left", "鼠标左键", "左键":
      return MouseTriggerConfig(label: label, buttonNumber: 0)
    case "mouse right", "right", "鼠标右键", "右键":
      return MouseTriggerConfig(label: label, buttonNumber: 1)
    default:
      return nil
    }
  }
}

enum AsrProfileKind: String, Sendable {
  case local
  case system
  case cloudUpload
  case cloudStreaming
}

struct AsrProfile: Sendable {
  let id: String
  let kind: AsrProfileKind
  let displayName: String
  let engine: String
  let baseUrl: String?
  let apiKey: String?
  let model: String?

  static let local = AsrProfile(id: "local-sensevoice", kind: .local, displayName: "本地 SenseVoice", engine: "SenseVoice", baseUrl: nil, apiKey: nil, model: "SenseVoiceSmall")
  static let system = AsrProfile(id: "system-speech", kind: .system, displayName: "系统语音识别", engine: "Apple Speech", baseUrl: nil, apiKey: nil, model: "zh_CN")

  var recordProvider: String {
    switch kind {
    case .local: return "local-sensevoice"
    case .system: return "system-speech"
    default: return id
    }
  }

  var recordModel: String {
    model?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? model! : engine
  }
}

enum HotKeyParser {
  struct Components {
    let key: String
    let modifiers: [String]

    var label: String {
      (modifiers + [key]).joined(separator: " + ")
    }
  }

  static func parse(label: String) -> HotKeyConfig? {
    guard let components = components(from: label) else { return nil }
    var modifiers: UInt32 = 0
    for part in components.modifiers {
      switch part {
      case "Option":
        modifiers |= UInt32(optionKey)
      case "Command":
        modifiers |= UInt32(cmdKey)
      case "Ctrl":
        modifiers |= UInt32(controlKey)
      case "Shift":
        modifiers |= UInt32(shiftKey)
      case "Fn":
        appLog("hotkey Fn modifier ignored because macOS Carbon hotkeys do not expose Fn as a stable modifier")
      default:
        appLog("hotkey modifier unsupported: \(part)")
      }
    }
    guard let keyCode = keyCode(for: components.key) else {
      appLog("hotkey key unsupported: \(components.key)")
      return nil
    }
    return HotKeyConfig(label: components.label, keyCode: keyCode, modifiers: modifiers)
  }

  static func triggerObject(label: String) -> [String: Any] {
    guard let components = components(from: label) else {
      return ["key": label, "modifiers": []]
    }
    return ["key": components.key, "modifiers": components.modifiers]
  }

  static func components(from label: String) -> Components? {
    let parts = label
      .split(separator: "+")
      .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    guard let key = parts.last.flatMap(normalizeKey) else { return nil }
    var modifiers: [String] = []
    for part in parts.dropLast() {
      switch part.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
      case "option", "alt", "左 alt", "右 alt":
        if !modifiers.contains("Option") { modifiers.append("Option") }
      case "command", "cmd", "meta", "⌘", "win", "windows", "左 win", "右 win":
        if !modifiers.contains("Command") { modifiers.append("Command") }
      case "control", "ctrl", "左 ctrl", "右 ctrl":
        if !modifiers.contains("Ctrl") { modifiers.append("Ctrl") }
      case "shift", "左 shift", "右 shift":
        if !modifiers.contains("Shift") { modifiers.append("Shift") }
      case "fn", "function":
        if !modifiers.contains("Fn") { modifiers.append("Fn") }
      default:
        appLog("hotkey modifier unsupported: \(part)")
      }
    }
    return Components(key: key, modifiers: modifiers)
  }

  private static func normalizeKey(_ key: String) -> String? {
    let normalized = key.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return nil }
    let lower = normalized.lowercased()
    switch lower {
    case "esc": return "Escape"
    case "return": return "Enter"
    case "up", "arrowup": return "Up"
    case "down", "arrowdown": return "Down"
    case "left", "arrowleft": return "Left"
    case "right", "arrowright": return "Right"
    case "pageup", "page up": return "Page Up"
    case "pagedown", "page down": return "Page Down"
    case "capslock", "caps lock": return "Caps Lock"
    case "scrolllock", "scroll lock": return "Scroll Lock"
    case "numlock", "num lock": return "Num Lock"
    case "backspace": return "Backspace"
    case "delete", "del": return "Delete"
    case "forward delete", "forwarddelete": return "Forward Delete"
    case "space", "tab", "enter", "escape", "home", "end", "insert": return normalized.prefix(1).uppercased() + normalized.dropFirst().lowercased()
    default:
      if lower.range(of: #"^f([1-9]|1[0-9]|20)$"#, options: .regularExpression) != nil {
        return lower.uppercased()
      }
      if normalized.count == 1 {
        return normalized.uppercased()
      }
      return normalized
    }
  }

  private static func keyCode(for key: String) -> UInt32? {
    switch key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "0": return UInt32(kVK_ANSI_0)
    case "1": return UInt32(kVK_ANSI_1)
    case "2": return UInt32(kVK_ANSI_2)
    case "3": return UInt32(kVK_ANSI_3)
    case "4": return UInt32(kVK_ANSI_4)
    case "5": return UInt32(kVK_ANSI_5)
    case "6": return UInt32(kVK_ANSI_6)
    case "7": return UInt32(kVK_ANSI_7)
    case "8": return UInt32(kVK_ANSI_8)
    case "9": return UInt32(kVK_ANSI_9)
    case "a": return UInt32(kVK_ANSI_A)
    case "b": return UInt32(kVK_ANSI_B)
    case "c": return UInt32(kVK_ANSI_C)
    case "d": return UInt32(kVK_ANSI_D)
    case "e": return UInt32(kVK_ANSI_E)
    case "f": return UInt32(kVK_ANSI_F)
    case "g": return UInt32(kVK_ANSI_G)
    case "h": return UInt32(kVK_ANSI_H)
    case "i": return UInt32(kVK_ANSI_I)
    case "j": return UInt32(kVK_ANSI_J)
    case "k": return UInt32(kVK_ANSI_K)
    case "l": return UInt32(kVK_ANSI_L)
    case "m": return UInt32(kVK_ANSI_M)
    case "n": return UInt32(kVK_ANSI_N)
    case "o": return UInt32(kVK_ANSI_O)
    case "p": return UInt32(kVK_ANSI_P)
    case "q": return UInt32(kVK_ANSI_Q)
    case "r": return UInt32(kVK_ANSI_R)
    case "s": return UInt32(kVK_ANSI_S)
    case "t": return UInt32(kVK_ANSI_T)
    case "u": return UInt32(kVK_ANSI_U)
    case "v": return UInt32(kVK_ANSI_V)
    case "w": return UInt32(kVK_ANSI_W)
    case "x": return UInt32(kVK_ANSI_X)
    case "y": return UInt32(kVK_ANSI_Y)
    case "z": return UInt32(kVK_ANSI_Z)
    case "-", "minus": return UInt32(kVK_ANSI_Minus)
    case "=", "equal", "equals": return UInt32(kVK_ANSI_Equal)
    case "[", "left bracket": return UInt32(kVK_ANSI_LeftBracket)
    case "]", "right bracket": return UInt32(kVK_ANSI_RightBracket)
    case "\\", "backslash": return UInt32(kVK_ANSI_Backslash)
    case ";", "semicolon": return UInt32(kVK_ANSI_Semicolon)
    case "'", "quote": return UInt32(kVK_ANSI_Quote)
    case ",", "comma": return UInt32(kVK_ANSI_Comma)
    case ".", "period": return UInt32(kVK_ANSI_Period)
    case "/", "slash": return UInt32(kVK_ANSI_Slash)
    case "`", "grave", "backquote": return UInt32(kVK_ANSI_Grave)
    case "space": return UInt32(kVK_Space)
    case "enter": return UInt32(kVK_Return)
    case "tab": return UInt32(kVK_Tab)
    case "escape": return UInt32(kVK_Escape)
    case "backspace": return UInt32(kVK_Delete)
    case "delete", "forward delete": return UInt32(kVK_ForwardDelete)
    case "home": return UInt32(kVK_Home)
    case "end": return UInt32(kVK_End)
    case "page up": return UInt32(kVK_PageUp)
    case "page down": return UInt32(kVK_PageDown)
    case "left": return UInt32(kVK_LeftArrow)
    case "right": return UInt32(kVK_RightArrow)
    case "up": return UInt32(kVK_UpArrow)
    case "down": return UInt32(kVK_DownArrow)
    case "caps lock": return UInt32(kVK_CapsLock)
    case "f1": return UInt32(kVK_F1)
    case "f2": return UInt32(kVK_F2)
    case "f3": return UInt32(kVK_F3)
    case "f4": return UInt32(kVK_F4)
    case "f5": return UInt32(kVK_F5)
    case "f6": return UInt32(kVK_F6)
    case "f7": return UInt32(kVK_F7)
    case "f8": return UInt32(kVK_F8)
    case "f9": return UInt32(kVK_F9)
    case "f10": return UInt32(kVK_F10)
    case "f11": return UInt32(kVK_F11)
    case "f12": return UInt32(kVK_F12)
    case "f13": return UInt32(kVK_F13)
    case "f14": return UInt32(kVK_F14)
    case "f15": return UInt32(kVK_F15)
    case "f16": return UInt32(kVK_F16)
    case "f17": return UInt32(kVK_F17)
    case "f18": return UInt32(kVK_F18)
    case "f19": return UInt32(kVK_F19)
    case "f20": return UInt32(kVK_F20)
    default: return nil
    }
  }
}

func defaultLlmProvidersRoot() -> [[String: Any]] {
  [
    ["key": "openai", "displayName": "OpenAI", "baseUrl": "https://api.openai.com/v1", "apiKey": "", "model": "gpt-4.1-mini", "enabled": false, "isDefault": false],
    ["key": "deepseek", "displayName": "DeepSeek", "baseUrl": "https://api.deepseek.com/v1", "apiKey": "", "model": "deepseek-chat", "enabled": false, "isDefault": true],
    ["key": "openrouter", "displayName": "OpenRouter", "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "", "model": "", "enabled": false, "isDefault": false],
    ["key": "siliconflow", "displayName": "硅基流动", "baseUrl": "https://api.siliconflow.cn/v1", "apiKey": "", "model": "", "enabled": false, "isDefault": false],
    ["key": "volcengine-ark", "displayName": "火山方舟", "baseUrl": "https://ark.cn-beijing.volces.com/api/v3", "apiKey": "", "model": "", "enabled": false, "isDefault": false],
    ["key": "dashscope", "displayName": "阿里云百炼", "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1", "apiKey": "", "model": "", "enabled": false, "isDefault": false],
    ["key": "moonshot", "displayName": "月之暗面 Kimi", "baseUrl": "https://api.moonshot.cn/v1", "apiKey": "", "model": "", "enabled": false, "isDefault": false],
    ["key": "zhipu", "displayName": "智谱 GLM", "baseUrl": "https://open.bigmodel.cn/api/paas/v4", "apiKey": "", "model": "", "enabled": false, "isDefault": false],
    ["key": "tencent-hunyuan", "displayName": "腾讯混元", "baseUrl": "https://api.hunyuan.cloud.tencent.com/v1", "apiKey": "", "model": "", "enabled": false, "isDefault": false],
    ["key": "gemini-compatible", "displayName": "Gemini Compatible", "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai", "apiKey": "", "model": "", "enabled": false, "isDefault": false],
    ["key": "ollama", "displayName": "Ollama", "baseUrl": "http://127.0.0.1:11434/v1", "apiKey": "", "model": "qwen2.5", "enabled": false, "isDefault": false],
    ["key": "custom-openai", "displayName": "自定义 OpenAI-compatible", "baseUrl": "", "apiKey": "", "model": "", "enabled": false, "isDefault": false]
  ]
}

func mergeLlmProviderSettings(_ savedProviders: [[String: Any]]?) -> [[String: Any]] {
  var merged = defaultLlmProvidersRoot()
  var indexByKey: [String: Int] = [:]
  for (index, provider) in merged.enumerated() {
    if let key = provider["key"] as? String {
      indexByKey[key] = index
    }
  }
  for saved in savedProviders ?? [] {
    guard let key = saved["key"] as? String, !key.isEmpty else { continue }
    if let index = indexByKey[key] {
      merged[index].merge(saved) { _, savedValue in savedValue }
    } else {
      indexByKey[key] = merged.count
      merged.append(saved)
    }
  }
  return merged
}

func defaultAsrProfilesRoot() -> [[String: Any]] {
  [
    ["id": "local-sensevoice", "kind": "local", "displayName": "本地 SenseVoice", "engine": "SenseVoice", "enabled": true, "model": "SenseVoiceSmall"],
    ["id": "system-speech", "kind": "system", "displayName": "系统语音识别", "engine": "Apple Speech", "enabled": true, "model": "zh_CN"],
    ["id": "cloud-upload-openai", "kind": "cloud-upload", "displayName": "云端上传转写 API", "engine": "openai-whisper", "enabled": false, "baseUrl": "https://api.openai.com", "apiKey": "", "model": "whisper-1"]
  ]
}

func mergeAsrProfilesRoot(_ savedProfiles: [[String: Any]]?) -> [[String: Any]] {
  var merged = defaultAsrProfilesRoot()
  var indexById: [String: Int] = [:]
  for (index, profile) in merged.enumerated() {
    if let id = profile["id"] as? String {
      indexById[id] = index
    }
  }
  for saved in savedProfiles ?? [] {
    guard let id = saved["id"] as? String, !id.isEmpty else { continue }
    if let index = indexById[id] {
      merged[index].merge(saved) { _, savedValue in savedValue }
    } else {
      indexById[id] = merged.count
      merged.append(saved)
    }
  }
  return merged
}

func defaultSettingsRoot() -> [String: Any] {
  [
    "settings": [
      "cleanup": [
        "enabled": false,
        "activeProviderKey": "deepseek",
        "prompt": defaultCleanupPrompt,
        "provider": [
          "type": "openai-compatible",
          "name": "DeepSeek",
          "baseUrl": "https://api.deepseek.com/v1",
          "apiKey": "",
          "model": "deepseek-chat"
        ],
        "providers": defaultLlmProvidersRoot()
      ],
      "input": [
        "triggerLabel": "Option + 2",
        "trigger": ["key": "Option + 2", "modifiers": []],
        "recordMode": "点击开始/停止",
        "asr": "Apple Speech",
        "asrAcceleration": "CPU",
        "localModelDir": runtimeRoot.appendingPathComponent("models").path,
        "senseVoiceModelPath": modelDir.path,
        "pythonPath": pythonPath.path,
        "outputMode": "粘贴到当前光标",
        "dataDir": dataDir.path,
        "microphoneDeviceId": "",
        "shortPressAction": "语音输入",
        "longPressAction": "语音助手",
        "smartMouseMode": false,
        "mouseTrigger": "Mouse Middle",
        "activeAsrProfileId": "system-speech",
        "defaultSystemAsrMigrated": true,
        "asrProfiles": defaultAsrProfilesRoot(),
        "wordbook": []
      ]
    ]
  ]
}

func writeSettingsRootFile(_ root: [String: Any]) throws {
  try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
  let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
  try data.write(to: settingsFile)
}

func migratedSettingsRoot() -> [String: Any] {
  var root: [String: Any]
  if let data = try? Data(contentsOf: settingsFile),
     let existingRoot = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
    root = existingRoot
  } else {
    root = defaultSettingsRoot()
    try? writeSettingsRootFile(root)
    appLog("settings missing, created defaults path=\(settingsFile.path)")
    return root
  }

  var changed = false
  var settings = root["settings"] as? [String: Any] ?? [:]
  var input = settings["input"] as? [String: Any] ?? [:]
  let mergedAsrProfiles = mergeAsrProfilesRoot(input["asrProfiles"] as? [[String: Any]])
  if !areJsonEqual(input["asrProfiles"], mergedAsrProfiles) {
    input["asrProfiles"] = mergedAsrProfiles
    changed = true
  }
  let activeAsrProfileId = string(input["activeAsrProfileId"], fallback: "")
  let defaultSystemMigrated = input["defaultSystemAsrMigrated"] as? Bool ?? false
  if activeAsrProfileId.isEmpty || (activeAsrProfileId == "local-sensevoice" && !defaultSystemMigrated) {
    input["activeAsrProfileId"] = "system-speech"
    input["asr"] = "Apple Speech"
    changed = true
  }
  if string(input["asrAcceleration"], fallback: "CPU") != "CPU" {
    input["asrAcceleration"] = "CPU"
    changed = true
  }
  if !defaultSystemMigrated {
    changed = true
  }
  input["defaultSystemAsrMigrated"] = true
  settings["input"] = input
  root["settings"] = settings
  if changed {
    try? writeSettingsRootFile(root)
  }
  return root
}

final class SnapSaySettingsStore: @unchecked Sendable {
  func load() -> SnapSaySettings {
    let root = migratedSettingsRoot()
    guard let settings = root["settings"] as? [String: Any] else {
      return SnapSaySettings()
    }

    let cleanup = settings["cleanup"] as? [String: Any]
    let input = settings["input"] as? [String: Any]
    let cleanupEnabled = cleanup?["enabled"] as? Bool ?? false
    let prompt = resolvePromptText(cleanup?["prompt"] as? String ?? defaultCleanupPrompt)
    let provider = resolveCleanupProvider(from: cleanup)
    let wordbook = readWordbook(from: input)
    let hotKey = readHotKey(from: input)
    let asrProfile = readAsrProfile(from: input)
    let outputMode = nonEmptyString(input?["outputMode"]) ?? "粘贴到当前光标"
    let microphoneDeviceId = nonEmptyString(input?["microphoneDeviceId"]) ?? ""
    let shortPressAction = nonEmptyString(input?["shortPressAction"]) ?? "语音输入"
    let longPressAction = nonEmptyString(input?["longPressAction"]) ?? "语音助手"
    let smartMouseMode = input?["smartMouseMode"] as? Bool ?? false
    let mouseTriggerLabel = nonEmptyString(input?["mouseTrigger"]) ?? "Mouse Middle"
    let mouseTrigger = MouseTriggerParser.parse(label: mouseTriggerLabel)
    appLog("settings loaded cleanupEnabled=\(cleanupEnabled) cleanupProvider=\(provider?.displayName ?? "none") wordbook=\(wordbook.count) hotkey=\(hotKey.label) mouse=\(mouseTriggerLabel) smartMouse=\(smartMouseMode) mic=\(microphoneDeviceId.isEmpty ? "default" : microphoneDeviceId) asr=\(asrProfile.id) outputMode=\(outputMode)")
    return SnapSaySettings(
      cleanupEnabled: cleanupEnabled,
      cleanupPrompt: prompt,
      cleanupProvider: provider,
      wordbook: wordbook,
      hotKey: hotKey,
      asrProfile: asrProfile,
      outputMode: outputMode,
      microphoneDeviceId: microphoneDeviceId,
      shortPressAction: shortPressAction,
      longPressAction: longPressAction,
      smartMouseMode: smartMouseMode,
      mouseTriggerLabel: mouseTriggerLabel,
      mouseTrigger: mouseTrigger
    )
  }

  private func resolveCleanupProvider(from cleanup: [String: Any]?) -> CleanupProvider? {
    guard let cleanup else { return nil }
    let activeKey = cleanup["activeProviderKey"] as? String
    if let providers = cleanup["providers"] as? [[String: Any]] {
      let active = providers.first { $0["key"] as? String == activeKey }
        ?? providers.first { $0["isDefault"] as? Bool == true }
        ?? providers.first
      if let provider = active,
         provider["enabled"] as? Bool == true,
         let baseUrl = nonEmptyString(provider["baseUrl"]),
         let apiKey = nonEmptyString(provider["apiKey"]),
         let model = nonEmptyString(provider["model"]) {
        return CleanupProvider(
          displayName: nonEmptyString(provider["displayName"]) ?? nonEmptyString(provider["key"]) ?? "OpenAI Compatible",
          baseUrl: baseUrl,
          apiKey: apiKey,
          model: model
        )
      }
    }

    if let legacy = cleanup["provider"] as? [String: Any],
       let baseUrl = nonEmptyString(legacy["baseUrl"]),
       let apiKey = nonEmptyString(legacy["apiKey"]),
       let model = nonEmptyString(legacy["model"]) {
      return CleanupProvider(displayName: nonEmptyString(legacy["name"]) ?? "OpenAI Compatible", baseUrl: baseUrl, apiKey: apiKey, model: model)
    }
    return nil
  }

  private func readWordbook(from input: [String: Any]?) -> [WordbookEntry] {
    guard let items = input?["wordbook"] as? [[String: Any]] else { return [] }
    return items.compactMap { item in
      guard let target = nonEmptyString(item["target"]) else { return nil }
      let variants = (item["variants"] as? [String] ?? []).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
      return WordbookEntry(target: target, variants: variants)
    }
  }

  private func readHotKey(from input: [String: Any]?) -> HotKeyConfig {
    if let label = nonEmptyString(input?["triggerLabel"]),
       let config = HotKeyParser.parse(label: label) {
      return config
    }
    if let trigger = input?["trigger"] as? [String: Any],
       let key = nonEmptyString(trigger["key"]) {
      let modifiers = (trigger["modifiers"] as? [String] ?? []).joined(separator: " + ")
      let label = modifiers.isEmpty ? key : "\(modifiers) + \(key)"
      if let config = HotKeyParser.parse(label: label) {
        return config
      }
    }
    appLog("hotkey settings missing or unsupported, using default Option + 2")
    return .default
  }

  private func readAsrProfile(from input: [String: Any]?) -> AsrProfile {
    guard let input else { return .system }
    let activeId = nonEmptyString(input["activeAsrProfileId"]) ?? "system-speech"
    guard let profiles = input["asrProfiles"] as? [[String: Any]],
          let profile = profiles.first(where: { nonEmptyString($0["id"]) == activeId }) else {
      return activeId == "local-sensevoice" ? .local : .system
    }
    let kindText = nonEmptyString(profile["kind"]) ?? "local"
    let kind: AsrProfileKind
    switch kindText {
    case "system": kind = .system
    case "cloud-upload": kind = .cloudUpload
    case "cloud-streaming": kind = .cloudStreaming
    default: kind = .local
    }
    guard kind != .local else { return .local }
    guard kind != .system else { return .system }
    return AsrProfile(
      id: activeId,
      kind: kind,
      displayName: nonEmptyString(profile["displayName"]) ?? activeId,
      engine: nonEmptyString(profile["engine"]) ?? "openai-whisper",
      baseUrl: nonEmptyString(profile["baseUrl"]),
      apiKey: nonEmptyString(profile["apiKey"]),
      model: nonEmptyString(profile["model"])
    )
  }

  private func nonEmptyString(_ value: Any?) -> String? {
    guard let text = value as? String else { return nil }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
}

final class CleanupClient: @unchecked Sendable {
  func cleanup(transcript: String, settings: SnapSaySettings) async throws -> String {
    guard let provider = settings.cleanupProvider else {
      throw NSError(domain: appName, code: 60, userInfo: [NSLocalizedDescriptionKey: "整理模型未配置"])
    }
    let urlText = provider.baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/chat/completions"
    guard let url = URL(string: urlText) else {
      throw NSError(domain: appName, code: 61, userInfo: [NSLocalizedDescriptionKey: "整理模型 Base URL 无效"])
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 45
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(provider.apiKey)", forHTTPHeaderField: "Authorization")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "model": provider.model,
      "temperature": 0.2,
      "messages": [
        ["role": "system", "content": settings.cleanupPrompt + buildWordbookPrompt(settings.wordbook)],
        ["role": "user", "content": transcript]
      ]
    ])

    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let body = String(data: data, encoding: .utf8) ?? ""
      throw NSError(domain: appName, code: status, userInfo: [NSLocalizedDescriptionKey: "整理模型 \(provider.displayName) HTTP \(status): \(maskSensitive(body, apiKey: provider.apiKey))"])
    }
    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let choices = json["choices"] as? [[String: Any]],
          let message = choices.first?["message"] as? [String: Any],
          let content = message["content"] as? String,
          !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw NSError(domain: appName, code: 62, userInfo: [NSLocalizedDescriptionKey: "整理模型没有返回文本"])
    }
    return content.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

final class CloudAsrClient: @unchecked Sendable {
  func transcribe(audio: Data, profile: AsrProfile) async throws -> String {
    guard profile.kind == .cloudUpload else {
      throw NSError(domain: appName, code: 70, userInfo: [NSLocalizedDescriptionKey: "当前版本暂未支持流式云端转写，请使用云端上传或本地 SenseVoice"])
    }
    guard let baseUrl = profile.baseUrl?.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
          let apiKey = profile.apiKey,
          let model = profile.model,
          !apiKey.isEmpty,
          !model.isEmpty else {
      throw NSError(domain: appName, code: 71, userInfo: [NSLocalizedDescriptionKey: "云端转写配置不完整，请填写 Base URL、API Key 和模型名"])
    }
    let normalizedApiKey = try normalizedHeaderApiKey(apiKey)
    guard let url = cloudAsrTranscriptionURL(baseUrl: baseUrl) else {
      throw NSError(domain: appName, code: 72, userInfo: [NSLocalizedDescriptionKey: "云端转写 Base URL 无效"])
    }

    let boundary = "----SnapSay\(Int(Date().timeIntervalSince1970 * 1000))"
    let audioMeta = audioFileMeta(audio)
    var body = Data()
    appendFormFile(name: "file", filename: audioMeta.filename, contentType: audioMeta.contentType, data: audio, boundary: boundary, to: &body)
    appendFormField(name: "model", value: model, boundary: boundary, to: &body)
    appendFormField(name: "language", value: "zh", boundary: boundary, to: &body)
    body.appendString("--\(boundary)--\r\n")

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 60
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(normalizedApiKey)", forHTTPHeaderField: "Authorization")
    request.httpBody = body

    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let responseText = String(data: data, encoding: .utf8) ?? ""
      throw NSError(domain: appName, code: status, userInfo: [NSLocalizedDescriptionKey: "云端转写 \(profile.displayName) HTTP \(status): \(maskSensitive(responseText, apiKey: apiKey))"])
    }
    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let text = json["text"] as? String,
          !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw NSError(domain: appName, code: 73, userInfo: [NSLocalizedDescriptionKey: "云端转写没有返回文本"])
    }
    return text
  }

  private func appendFormField(name: String, value: String, boundary: String, to body: inout Data) {
    body.appendString("--\(boundary)\r\n")
    body.appendString("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
    body.appendString("\(value)\r\n")
  }

  private func appendFormFile(name: String, filename: String, contentType: String, data: Data, boundary: String, to body: inout Data) {
    body.appendString("--\(boundary)\r\n")
    body.appendString("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n")
    body.appendString("Content-Type: \(contentType)\r\n\r\n")
    body.append(data)
    body.appendString("\r\n")
  }
}

final class SnapSayRecordStore: @unchecked Sendable {
  func addRecord(
    transcript: String,
    cleanedText: String?,
    status: String,
    error: String?,
    asrDurationMs: Int?,
    cleanupDurationMs: Int?,
    durationMs: Int?,
    pasteSucceeded: Bool,
    asrProvider: String?,
    asrModel: String?,
    cleanupProvider: String?,
    cleanupModel: String?
  ) -> String? {
    let id = "rec_\(Int(Date().timeIntervalSince1970 * 1000))_snapsay"
    do {
      try ensureSchema()
      let now = ISO8601DateFormatter().string(from: Date())
      let sql = """
      INSERT INTO transcription_records (
        id, transcript, cleaned_text, user_correction, status, error,
        asr_provider, asr_model, cleanup_provider, cleanup_model,
        duration_ms, asr_duration_ms, cleanup_duration_ms, total_tokens,
        paste_succeeded, created_at, updated_at
      ) VALUES (
        \(sqlString(id)), \(sqlString(transcript)), \(sqlNullable(cleanedText)), NULL, \(sqlString(status)), \(sqlNullable(error)),
        \(sqlNullable(asrProvider ?? "local-sensevoice")), \(sqlNullable(asrModel ?? "SenseVoiceSmall")), \(sqlNullable(cleanupProvider)), \(sqlNullable(cleanupModel)),
        \(sqlNumber(durationMs)), \(sqlNumber(asrDurationMs)), \(sqlNumber(cleanupDurationMs)), NULL,
        \(pasteSucceeded ? 1 : 0), \(sqlString(now)), \(sqlString(now))
      );
      """
      try runSql(sql)
      appLog("record saved status=\(status) transcriptChars=\(transcript.count) cleanedChars=\(cleanedText?.count ?? 0)")
      return id
    } catch {
      appLog("record save failed: \(error.localizedDescription)")
      return nil
    }
  }

  private func ensureSchema() throws {
    try runSql("""
    CREATE TABLE IF NOT EXISTS transcription_records (
      id TEXT PRIMARY KEY,
      transcript TEXT NOT NULL,
      cleaned_text TEXT,
      user_correction TEXT,
      status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
      error TEXT,
      asr_provider TEXT,
      asr_model TEXT,
      cleanup_provider TEXT,
      cleanup_model TEXT,
      duration_ms INTEGER,
      asr_duration_ms INTEGER,
      cleanup_duration_ms INTEGER,
      total_tokens INTEGER,
      paste_succeeded INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transcription_records_created_at
      ON transcription_records(created_at DESC);
    """)
  }

  private func runSql(_ sql: String) throws {
    try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
    let process = Process()
    let input = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
    process.arguments = ["-cmd", ".timeout 30000", recordDbFile.path]
    process.standardInput = input
    try process.run()
    if let data = sql.data(using: .utf8) {
      try? input.fileHandleForWriting.write(contentsOf: data)
    }
    try? input.fileHandleForWriting.close()
    process.waitUntilExit()
    if process.terminationStatus != 0 {
      throw NSError(domain: appName, code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: "sqlite3 failed"])
    }
  }

  private func sqlString(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "''"))'"
  }

  private func sqlNullable(_ value: String?) -> String {
    guard let value, !value.isEmpty else { return "NULL" }
    return sqlString(value)
  }

  private func sqlNumber(_ value: Int?) -> String {
    value.map(String.init) ?? "NULL"
  }
}

final class SnapSayDashboardStore: @unchecked Sendable {
  func dashboard() -> [String: Any] {
    [
      "settings": rendererSettings(),
      "records": rendererRecords()
    ]
  }

  func recordForRenderer(id: String) -> [String: Any]? {
    rendererRecord(id: id)
  }

  func saveRendererSettings(_ renderer: [String: Any]) throws {
    var root = settingsRoot()
    var settings = root["settings"] as? [String: Any] ?? [:]
    var cleanup = settings["cleanup"] as? [String: Any] ?? [:]
    var input = settings["input"] as? [String: Any] ?? [:]

    cleanup["enabled"] = renderer["cleanupEnabled"] as? Bool ?? false
    cleanup["provider"] = [
      "type": "openai-compatible",
      "name": string(renderer["provider"], fallback: "DeepSeek"),
      "baseUrl": string(renderer["baseURL"], fallback: "https://api.deepseek.com/v1"),
      "apiKey": string(renderer["apiKey"], fallback: ""),
      "model": string(renderer["model"], fallback: "deepseek-chat")
    ]
    cleanup["providers"] = mergeLlmProviderSettings(renderer["llmProviders"] as? [[String: Any]] ?? cleanup["providers"] as? [[String: Any]])
    cleanup["activeProviderKey"] = string(renderer["activeLlmProviderKey"], fallback: "deepseek")
    cleanup["prompt"] = string(renderer["prompt"], fallback: defaultCleanupPrompt)

    let triggerKey = string(renderer["triggerKey"], fallback: "Option + 2")
    let trigger = HotKeyParser.triggerObject(label: triggerKey)
    let triggerModifiers = trigger["modifiers"] as? [String] ?? []
    let triggerLabel = (triggerModifiers + [string(trigger["key"], fallback: triggerKey)]).joined(separator: " + ")
    input["triggerLabel"] = triggerLabel
    input["trigger"] = trigger
    input["recordMode"] = string(renderer["recordMode"], fallback: "点击开始/停止")
    input["asr"] = string(renderer["asr"], fallback: "Apple Speech")
    input["asrAcceleration"] = "CPU"
    input["localModelDir"] = string(renderer["localModelDir"], fallback: runtimeRoot.appendingPathComponent("models").path)
    input["senseVoiceModelPath"] = string(renderer["senseVoiceModelPath"], fallback: modelDir.path)
    input["pythonPath"] = string(renderer["pythonPath"], fallback: pythonPath.path)
    input["outputMode"] = string(renderer["outputMode"], fallback: "粘贴到当前光标")
    input["dataDir"] = string(renderer["dataDir"], fallback: dataDir.path)
    input["microphoneDeviceId"] = string(renderer["microphoneDeviceId"], fallback: "")
    input["shortPressAction"] = string(renderer["shortPressAction"], fallback: "语音输入")
    input["longPressAction"] = string(renderer["longPressAction"], fallback: "语音助手")
    input["smartMouseMode"] = renderer["smartMouseMode"] as? Bool ?? false
    input["mouseTrigger"] = string(renderer["mouseTrigger"], fallback: "Mouse Middle")
    input["asrProfiles"] = renderer["asrProfiles"] as? [[String: Any]] ?? input["asrProfiles"]
    input["activeAsrProfileId"] = string(renderer["activeAsrProfileId"], fallback: "system-speech")
    if let cloudBaseUrl = renderer["cloudAsrBaseUrl"] as? String, !cloudBaseUrl.isEmpty {
      input["cloudAsr"] = [
        "type": string(renderer["cloudAsrType"], fallback: "openai-whisper"),
        "baseUrl": cloudBaseUrl,
        "apiKey": string(renderer["cloudAsrApiKey"], fallback: ""),
        "model": string(renderer["cloudAsrModel"], fallback: "whisper-1")
      ]
    }

    settings["cleanup"] = cleanup
    settings["input"] = input
    root["settings"] = settings
    try writeSettingsRoot(root)
    postAppNotification(snapsaySettingsChangedNotification)
    appLog("web settings saved trigger=\(triggerKey)")
  }

  func saveWordbook(_ wordbook: [[String: Any]]) throws {
    var root = settingsRoot()
    var settings = root["settings"] as? [String: Any] ?? [:]
    var input = settings["input"] as? [String: Any] ?? [:]
    input["wordbook"] = wordbook
    settings["input"] = input
    root["settings"] = settings
    try writeSettingsRoot(root)
  }

  func deleteRecord(id: String) throws {
    try runSql("DELETE FROM transcription_records WHERE id = \(sqlString(id));")
  }

  func clearAllRecords() throws {
    try runSql("DELETE FROM transcription_records;")
  }

  func clearDiagnosticLogs() throws -> [String: Any] {
    try runSql("UPDATE transcription_records SET error = NULL, updated_at = \(sqlString(ISO8601DateFormatter().string(from: Date()))) WHERE error IS NOT NULL;")
    return ["records": rendererRecords()]
  }

  func pasteRecord(id: String) throws -> [String: Any] {
    guard let record = rawRecord(id: id) else {
      return ["ok": false, "message": "记录不存在"]
    }
    let text = string(record["cleaned_text"], fallback: string(record["transcript"], fallback: ""))
    guard !text.isEmpty else {
      return ["ok": false, "message": "记录没有可粘贴文本"]
    }
    try PasteController().paste(text: text)
    return ["ok": true]
  }

  func rewriteRecord(id: String) async throws -> [String: Any] {
    guard let record = rawRecord(id: id) else {
      return ["ok": false, "message": "记录不存在"]
    }
    var settings = SnapSaySettingsStore().load()
    guard settings.cleanupProvider != nil else {
      return ["ok": false, "message": "整理 API 未配置"]
    }
    settings.cleanupEnabled = true
    let transcript = string(record["transcript"], fallback: "")
    let cleaned = try await CleanupClient().cleanup(transcript: transcript, settings: settings)
    try updateRecord(id: id, fields: [
      "cleaned_text": cleaned,
      "status": "completed",
      "cleanup_provider": settings.cleanupProvider?.displayName as Any,
      "cleanup_model": settings.cleanupProvider?.model as Any,
      "updated_at": ISO8601DateFormatter().string(from: Date())
    ])
    return ["ok": true, "text": cleaned, "record": rendererRecord(id: id) ?? [:]]
  }

  func saveCorrection(id: String, correctionText: String) throws -> [String: Any] {
    guard let record = rawRecord(id: id) else {
      return ["ok": false, "pairs": [], "wordbook": []]
    }
    try updateRecord(id: id, fields: [
      "user_correction": correctionText,
      "updated_at": ISO8601DateFormatter().string(from: Date())
    ])
    let original = string(record["cleaned_text"], fallback: string(record["transcript"], fallback: ""))
    let pairs = extractWordPairCandidates(original: original, corrected: correctionText)
    let current = currentWordbook()
    let merge = mergeWordbookPairs(entries: current, pairs: pairs)
    try saveWordbook(merge.wordbook)
    return ["ok": true, "pairs": merge.addedPairs, "wordbook": merge.wordbook]
  }

  func extractWordPairs(id: String) throws -> [String: Any] {
    guard let record = rawRecord(id: id),
          let correction = record["user_correction"] as? String,
          !correction.isEmpty else {
      return ["ok": false, "pairs": []]
    }
    let original = string(record["cleaned_text"], fallback: string(record["transcript"], fallback: ""))
    return ["ok": true, "pairs": extractWordPairCandidates(original: original, corrected: correction)]
  }

  @MainActor
  func exportRecords() async throws -> [String: Any] {
    let panel = NSSavePanel()
    panel.title = "导出全部数据"
    panel.nameFieldStringValue = "snapsay-records-\(Date().isoDateOnly).json"
    panel.allowedContentTypes = [.json]
    let response = await panel.begin()
    guard response == .OK, let url = panel.url else {
      return ["ok": false, "canceled": true]
    }
    let records = rawRecords()
    let wordbook = currentWordbook()
    let payload: [String: Any] = [
      "app": "SnapSay",
      "version": 2,
      "exportedAt": ISO8601DateFormatter().string(from: Date()),
      "records": records,
      "wordbook": wordbook
    ]
    let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: url)
    return ["ok": true, "count": records.count, "wordbookCount": wordbook.count, "filePath": url.path]
  }

  @MainActor
  func importRecords() async throws -> [String: Any] {
    let panel = NSOpenPanel()
    panel.title = "导入全部数据"
    panel.allowsMultipleSelection = false
    panel.allowedContentTypes = [.json]
    let response = await panel.begin()
    guard response == .OK, let url = panel.url else {
      return ["ok": false, "canceled": true]
    }
    return try await Task.detached(priority: .userInitiated) {
      try self.importRecordsFromFile(url)
    }.value
  }

  func importRecordsFromFile(_ url: URL) throws -> [String: Any] {
    appLog("records import start file=\(url.path)")
    let data = try Data(contentsOf: url)
    let decoded = try JSONSerialization.jsonObject(with: data)
    let payload = decoded as? [String: Any] ?? [:]
    let records: [[String: Any]]
    if let items = payload["records"] as? [[String: Any]] {
      records = items
    } else if let items = decoded as? [[String: Any]] {
      records = items
    } else {
      records = []
    }
    var imported = 0
    var updated = 0
    var skipped = 0

    try ensureRecordSchema()
    let existingIds = try existingRecordIds(for: records.compactMap { string($0["id"], fallback: "") })
    var statements: [String] = ["BEGIN TRANSACTION;"]
    for record in records {
      do {
        let id = string(record["id"], fallback: "")
        let exists = existingIds.contains(id)
        statements.append(try upsertImportedRecordSql(record))
        if exists { updated += 1 } else { imported += 1 }
      } catch {
        skipped += 1
      }
    }
    statements.append("COMMIT;")
    if statements.count > 2 {
      try runSql(statements.joined(separator: "\n"))
    }

    let importedWordbook = normalizeWordbook(payload["wordbook"] as? [[String: Any]] ?? [])
    let merged = mergeWordbookEntries(existing: currentWordbook(), imported: importedWordbook)
    if !importedWordbook.isEmpty {
      try saveWordbook(merged)
    }
    let renderer = rendererRecords()
    appLog("records import completed file=\(url.lastPathComponent) imported=\(imported) updated=\(updated) skipped=\(skipped) wordbook=\(importedWordbook.count) total=\(renderer.count)")
    return [
      "ok": true,
      "imported": imported,
      "updated": updated,
      "skipped": skipped,
      "wordbookImported": importedWordbook.count,
      "wordbook": merged,
      "records": rendererRecords()
    ]
  }

  @MainActor
  func exportWordbook() async throws -> [String: Any] {
    let panel = NSSavePanel()
    panel.title = "导出词库"
    panel.nameFieldStringValue = "snapsay-wordbook-\(Date().isoDateOnly).json"
    panel.allowedContentTypes = [.json]
    let response = await panel.begin()
    guard response == .OK, let url = panel.url else {
      return ["ok": false, "canceled": true]
    }
    let wordbook = currentWordbook()
    let payload: [String: Any] = [
      "app": "SnapSay",
      "type": "wordbook",
      "version": 1,
      "exportedAt": ISO8601DateFormatter().string(from: Date()),
      "wordbook": wordbook
    ]
    let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: url)
    return ["ok": true, "count": wordbook.count, "filePath": url.path]
  }

  @MainActor
  func importWordbook() async throws -> [String: Any] {
    let panel = NSOpenPanel()
    panel.title = "导入词库"
    panel.allowsMultipleSelection = false
    panel.allowedContentTypes = [.json]
    let response = await panel.begin()
    guard response == .OK, let url = panel.url else {
      return ["ok": false, "canceled": true]
    }
    let data = try Data(contentsOf: url)
    let payload = try JSONSerialization.jsonObject(with: data)
    let raw = (payload as? [[String: Any]])
      ?? ((payload as? [String: Any])?["wordbook"] as? [[String: Any]])
      ?? []
    let imported = normalizeWordbook(raw)
    let merged = mergeWordbookEntries(existing: currentWordbook(), imported: imported)
    try saveWordbook(merged)
    return ["ok": true, "imported": imported.count, "total": merged.count, "wordbook": merged]
  }

  func testRewriteApi(rendererSettings: [String: Any]?) async throws -> [String: Any] {
    var settings = SnapSaySettingsStore().load()
    if let rendererSettings,
       string(rendererSettings["provider"], fallback: "") == "cloud-asr" {
      let profile = AsrProfile(
        id: "cloud-asr-test",
        kind: .cloudUpload,
        displayName: "云端 ASR",
        engine: "openai-whisper",
        baseUrl: string(rendererSettings["baseURL"], fallback: ""),
        apiKey: string(rendererSettings["apiKey"], fallback: ""),
        model: string(rendererSettings["model"], fallback: "")
      )
      guard profile.baseUrl?.isEmpty == false,
            profile.apiKey?.isEmpty == false,
            profile.model?.isEmpty == false else {
        return ["ok": false, "message": "云端 ASR 配置不完整"]
      }
      guard let url = cloudAsrTranscriptionURL(baseUrl: profile.baseUrl ?? "") else {
        return ["ok": false, "message": "云端 ASR Base URL 无效"]
      }
      let sample = runtimeRoot.appendingPathComponent("tmp/asr-selftest/zh.wav")
      guard let audio = try? Data(contentsOf: sample) else {
        return ["ok": true, "message": "配置格式有效，缺少本地测试音频，未发起转写请求", "endpoint": url.absoluteString]
      }
      let start = Date()
      _ = try await CloudAsrClient().transcribe(audio: audio, profile: profile)
      return ["ok": true, "message": "云端 ASR 连接成功", "durationMs": Date().millisecondsSince(start), "endpoint": url.absoluteString]
    }
    if let rendererSettings {
      let provider = CleanupProvider(
        displayName: string(rendererSettings["provider"], fallback: "OpenAI Compatible"),
        baseUrl: string(rendererSettings["baseURL"], fallback: ""),
        apiKey: string(rendererSettings["apiKey"], fallback: ""),
        model: string(rendererSettings["model"], fallback: "")
      )
      settings.cleanupProvider = provider
      settings.cleanupEnabled = true
      settings.cleanupPrompt = string(rendererSettings["prompt"], fallback: defaultCleanupPrompt)
    }
    let start = Date()
    _ = try await CleanupClient().cleanup(transcript: "ping", settings: settings)
    return ["ok": true, "durationMs": Date().millisecondsSince(start)]
  }

  func localModelStatus() -> [String: Any] {
    let pythonReady = localAsrRuntimeReady()
    let requiredFiles = senseVoiceOnnxFiles.map { file -> [String: Any] in
      let url = modelDir.appendingPathComponent(file.name)
      let size = fileSize(url)
      return [
        "name": file.name,
        "path": url.path,
        "exists": size >= file.minBytes,
        "minBytes": file.minBytes,
        "sizeBytes": size
      ]
    }
    var missing = requiredFiles.compactMap { file -> String? in
      let size = (file["sizeBytes"] as? Int) ?? 0
      let minBytes = (file["minBytes"] as? Int) ?? 1
      return size < minBytes ? file["name"] as? String : nil
    }
    if !pythonReady {
      missing.insert("Python/ONNX 运行环境", at: 0)
    }
    return [
      "modelDir": modelDir.path,
      "runtimeDir": runtimeRoot.path,
      "pythonPath": pythonPath.path,
      "pythonReady": pythonReady,
      "ready": missing.isEmpty,
      "installed": missing.isEmpty,
      "missing": missing,
      "missingFiles": missing,
      "requiredFiles": requiredFiles
    ]
  }

  func localAsrNotice() -> [String: Any]? {
    guard SnapSaySettingsStore().load().asrProfile.kind == .local else {
      SnapSayLocalAsrNoticeStore.shared.clear()
      return nil
    }
    let status = localModelStatus()
    if (status["installed"] as? Bool) != true {
      let missing = status["missingFiles"] as? [String] ?? []
      let message = "本地语音模型未安装。请打开「模型」页面，点击「下载模型」后再录音。缺少文件：\(missing.joined(separator: "、"))"
      SnapSayLocalAsrNoticeStore.shared.set(message)
      return SnapSayLocalAsrNoticeStore.shared.current()
    }
    SnapSayLocalAsrNoticeStore.shared.clear()
    return nil
  }

  func downloadLocalModel() async throws -> [String: Any] {
    let status = localModelStatus()
    if (status["installed"] as? Bool) == true {
      SnapSayLocalAsrNoticeStore.shared.clear()
      return status.merging(["ok": true, "message": "模型已就绪，无需下载"]) { _, new in new }
    }
    try await ensureLocalAsrRuntime()
    try FileManager.default.createDirectory(at: modelDir, withIntermediateDirectories: true)
    for file in senseVoiceOnnxFiles {
      let target = modelDir.appendingPathComponent(file.name)
      let temp = target.appendingPathExtension("download")
      try? FileManager.default.removeItem(at: temp)
      appLog("local model download start file=\(file.name) url=\(file.url)")
      guard let url = URL(string: file.url) else {
        throw NSError(domain: appName, code: 100, userInfo: [NSLocalizedDescriptionKey: "模型下载地址无效：\(file.name)"])
      }
      var request = URLRequest(url: url)
      request.timeoutInterval = 60
      request.setValue("Mozilla/5.0 AppleWebKit/537.36 SnapSay/0.1.0", forHTTPHeaderField: "User-Agent")
      request.setValue("application/octet-stream,*/*", forHTTPHeaderField: "Accept")
      request.setValue("https://www.modelscope.cn/models/iic/SenseVoiceSmall-onnx/files", forHTTPHeaderField: "Referer")
      let (data, response) = try await URLSession.shared.data(for: request)
      let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
      guard (200..<300).contains(statusCode) else {
        throw NSError(domain: appName, code: statusCode, userInfo: [NSLocalizedDescriptionKey: "模型下载失败 HTTP \(statusCode)：\(file.name)"])
      }
      try data.write(to: temp, options: .atomic)
      let size = fileSize(temp)
      guard size >= file.minBytes else {
        try? FileManager.default.removeItem(at: temp)
        throw NSError(domain: appName, code: 101, userInfo: [NSLocalizedDescriptionKey: "模型文件过小：\(file.name)"])
      }
      try? FileManager.default.removeItem(at: target)
      try FileManager.default.moveItem(at: temp, to: target)
      appLog("local model download completed file=\(file.name) bytes=\(size)")
    }
    SnapSayLocalAsrNoticeStore.shared.clear()
    return localModelStatus().merging(["ok": true, "message": "模型下载完成"]) { _, new in new }
  }

  private func ensureLocalAsrRuntime() async throws {
    if localAsrRuntimeReady() {
      appLog("local ASR runtime already exists python=\(pythonPath.path)")
      return
    }
    guard let script = Bundle.main.resourceURL?.appendingPathComponent("setup-onnx-asr-macos.sh"),
          FileManager.default.fileExists(atPath: script.path) else {
      throw NSError(domain: appName, code: 102, userInfo: [NSLocalizedDescriptionKey: "SnapSay 缺少本地 ASR 运行时安装脚本"])
    }
    try FileManager.default.createDirectory(at: runtimeRoot, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
    appLog("local ASR runtime setup start script=\(script.path) root=\(runtimeRoot.path)")
    try await runProcess(
      executable: URL(fileURLWithPath: "/bin/bash"),
      arguments: [script.path],
      environment: ["SNAPSAY_ROOT": runtimeRoot.path],
      logName: "snapsay-asr-setup"
    )
    guard FileManager.default.isExecutableFile(atPath: pythonPath.path) else {
      throw NSError(domain: appName, code: 103, userInfo: [NSLocalizedDescriptionKey: "本地 ASR 运行环境安装失败，未找到 \(pythonPath.path)"])
    }
    guard localAsrRuntimeReady() else {
      throw NSError(domain: appName, code: 104, userInfo: [NSLocalizedDescriptionKey: "本地 ASR 运行环境安装不完整，请重试下载模型"])
    }
    appLog("local ASR runtime setup completed python=\(pythonPath.path)")
  }

  private func rendererSettings() -> [String: Any] {
    let root = settingsRoot()
    let settings = root["settings"] as? [String: Any] ?? [:]
    let cleanup = settings["cleanup"] as? [String: Any] ?? [:]
    let input = settings["input"] as? [String: Any] ?? [:]
    let provider = cleanup["provider"] as? [String: Any] ?? [:]
    let cloudAsr = input["cloudAsr"] as? [String: Any] ?? [:]
    let llmProviders = mergeLlmProviderSettings(cleanup["providers"] as? [[String: Any]])
    return [
      "triggerKey": string(input["triggerLabel"], fallback: "Option + 2"),
      "recordMode": string(input["recordMode"], fallback: "点击开始/停止"),
      "asr": string(input["asr"], fallback: "Apple Speech"),
      "asrAcceleration": "CPU",
      "localModelDir": string(input["localModelDir"], fallback: runtimeRoot.appendingPathComponent("models").path),
      "senseVoiceModelPath": string(input["senseVoiceModelPath"], fallback: modelDir.path),
      "pythonPath": string(input["pythonPath"], fallback: pythonPath.path),
      "cleanupEnabled": cleanup["enabled"] as? Bool ?? false,
      "provider": string(provider["name"], fallback: "DeepSeek"),
      "baseURL": string(provider["baseUrl"], fallback: "https://api.deepseek.com/v1"),
      "model": string(provider["model"], fallback: "deepseek-chat"),
      "apiKey": string(provider["apiKey"], fallback: ""),
      "llmProviders": llmProviders,
      "activeLlmProviderKey": string(cleanup["activeProviderKey"], fallback: "deepseek"),
      "prompt": string(cleanup["prompt"], fallback: defaultCleanupPrompt),
      "outputMode": string(input["outputMode"], fallback: "粘贴到当前光标"),
      "dataDir": string(input["dataDir"], fallback: dataDir.path),
      "microphoneDeviceId": string(input["microphoneDeviceId"], fallback: ""),
      "shortPressAction": string(input["shortPressAction"], fallback: "语音输入"),
      "longPressAction": string(input["longPressAction"], fallback: "语音助手"),
      "smartMouseMode": input["smartMouseMode"] as? Bool ?? false,
      "mouseTrigger": string(input["mouseTrigger"], fallback: "Mouse Middle"),
      "cloudAsrType": string(cloudAsr["type"], fallback: "openai-whisper"),
      "cloudAsrBaseUrl": string(cloudAsr["baseUrl"], fallback: ""),
      "cloudAsrApiKey": string(cloudAsr["apiKey"], fallback: ""),
      "cloudAsrModel": string(cloudAsr["model"], fallback: "whisper-1"),
      "asrProfiles": input["asrProfiles"] as? [[String: Any]] ?? [],
      "activeAsrProfileId": string(input["activeAsrProfileId"], fallback: "system-speech"),
      "wordbook": input["wordbook"] as? [[String: Any]] ?? []
    ]
  }

  private func rendererRecords() -> [[String: Any]] {
    try? ensureRecordSchema()
    let sql = """
    SELECT id, transcript, cleaned_text, user_correction, status, error,
           asr_provider, asr_model, cleanup_provider, cleanup_model,
           duration_ms, asr_duration_ms, cleanup_duration_ms, total_tokens,
           paste_succeeded, created_at, updated_at
    FROM transcription_records ORDER BY created_at DESC LIMIT 500;
    """
    guard let rows = try? runSqlJson(sql) else { return [] }
    return rows.map { row in
      let status = string(row["status"], fallback: "") == "completed"
        ? ((row["paste_succeeded"] as? Int) == 0 ? "已复制" : "已输入")
        : "失败"
      return [
        "id": string(row["id"], fallback: UUID().uuidString),
        "time": formatRecordTime(string(row["created_at"], fallback: "")),
        "original": string(row["transcript"], fallback: ""),
        "refined": string(row["cleaned_text"], fallback: string(row["transcript"], fallback: "")),
        "userCorrection": row["user_correction"] ?? NSNull(),
        "status": status,
        "asr": [row["asr_provider"], row["asr_model"]].compactMap { $0 as? String }.filter { !$0.isEmpty }.joined(separator: " / "),
        "cleanup": [row["cleanup_provider"], row["cleanup_model"]].compactMap { $0 as? String }.filter { !$0.isEmpty }.joined(separator: " / "),
        "durationMs": row["duration_ms"] ?? NSNull(),
        "asrDurationMs": row["asr_duration_ms"] ?? NSNull(),
        "cleanupDurationMs": row["cleanup_duration_ms"] ?? NSNull(),
        "totalTokens": row["total_tokens"] ?? NSNull(),
        "pasteSucceeded": (row["paste_succeeded"] as? Int).map { $0 != 0 } ?? NSNull(),
        "error": row["error"] ?? NSNull()
      ]
    }
  }

  private func rendererRecord(id: String) -> [String: Any]? {
    rendererRecords().first { string($0["id"], fallback: "") == id }
  }

  private func rawRecord(id: String) -> [String: Any]? {
    guard !id.isEmpty else { return nil }
    try? ensureRecordSchema()
    return try? runSqlJson("""
    SELECT id, transcript, cleaned_text, user_correction, status, error,
           asr_provider, asr_model, cleanup_provider, cleanup_model,
           duration_ms, asr_duration_ms, cleanup_duration_ms, total_tokens,
           paste_succeeded, created_at, updated_at
    FROM transcription_records WHERE id = \(sqlString(id)) LIMIT 1;
    """).first
  }

  private func rawRecords() -> [[String: Any]] {
    try? ensureRecordSchema()
    return (try? runSqlJson("""
    SELECT id, transcript, cleaned_text as cleanedText, user_correction as userCorrection,
           status, error, asr_provider as asrProvider, asr_model as asrModel,
           cleanup_provider as cleanupProvider, cleanup_model as cleanupModel,
           duration_ms as durationMs, asr_duration_ms as asrDurationMs,
           cleanup_duration_ms as cleanupDurationMs, total_tokens as totalTokens,
           paste_succeeded as pasteSucceeded, created_at as createdAt, updated_at as updatedAt
    FROM transcription_records ORDER BY created_at DESC;
    """)) ?? []
  }

  private func updateRecord(id: String, fields: [String: Any?]) throws {
    let assignments = fields.map { key, value in
      "\(key) = \(sqlValue(value ?? nil))"
    }.joined(separator: ", ")
    guard !assignments.isEmpty else { return }
    try runSql("UPDATE transcription_records SET \(assignments) WHERE id = \(sqlString(id));")
  }

  private func upsertImportedRecord(_ record: [String: Any]) throws {
    try runSql(try upsertImportedRecordSql(record))
  }

  private func upsertImportedRecordSql(_ record: [String: Any]) throws -> String {
    let now = ISO8601DateFormatter().string(from: Date())
    let id = string(record["id"], fallback: "rec_\(Int(Date().timeIntervalSince1970 * 1000))_import")
    let transcript = string(record["transcript"], fallback: string(record["original"], fallback: ""))
    guard !transcript.isEmpty else {
      throw NSError(domain: appName, code: 80, userInfo: [NSLocalizedDescriptionKey: "imported record missing transcript"])
    }
    return """
    INSERT INTO transcription_records (
      id, transcript, cleaned_text, user_correction, status, error,
      asr_provider, asr_model, cleanup_provider, cleanup_model,
      duration_ms, asr_duration_ms, cleanup_duration_ms, total_tokens,
      paste_succeeded, created_at, updated_at
    ) VALUES (
      \(sqlString(id)), \(sqlString(transcript)), \(sqlValue(record["cleanedText"])), \(sqlValue(record["userCorrection"])), \(sqlString(normalizeRecordStatus(record["status"]))), \(sqlValue(record["error"])),
      \(sqlValue(record["asrProvider"])), \(sqlValue(record["asrModel"])), \(sqlValue(record["cleanupProvider"])), \(sqlValue(record["cleanupModel"])),
      \(sqlValue(record["durationMs"])), \(sqlValue(record["asrDurationMs"])), \(sqlValue(record["cleanupDurationMs"])), \(sqlValue(record["totalTokens"])),
      \(sqlBool(record["pasteSucceeded"])), \(sqlString(string(record["createdAt"], fallback: now))), \(sqlString(string(record["updatedAt"], fallback: now)))
    )
    ON CONFLICT(id) DO UPDATE SET
      transcript = excluded.transcript,
      cleaned_text = excluded.cleaned_text,
      user_correction = excluded.user_correction,
      status = excluded.status,
      error = excluded.error,
      asr_provider = excluded.asr_provider,
      asr_model = excluded.asr_model,
      cleanup_provider = excluded.cleanup_provider,
      cleanup_model = excluded.cleanup_model,
      duration_ms = excluded.duration_ms,
      asr_duration_ms = excluded.asr_duration_ms,
      cleanup_duration_ms = excluded.cleanup_duration_ms,
      total_tokens = excluded.total_tokens,
      paste_succeeded = excluded.paste_succeeded,
      updated_at = excluded.updated_at;
    """
  }

  private func existingRecordIds(for ids: [String]) throws -> Set<String> {
    let uniqueIds = uniqueStrings(ids.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }).filter { !$0.isEmpty }
    guard !uniqueIds.isEmpty else { return [] }
    var result = Set<String>()
    let chunkSize = 400
    var start = 0
    while start < uniqueIds.count {
      let chunk = Array(uniqueIds[start..<min(start + chunkSize, uniqueIds.count)])
      let sql = "SELECT id FROM transcription_records WHERE id IN (\(chunk.map(sqlString).joined(separator: ",")));"
      for row in try runSqlJson(sql) {
        if let id = row["id"] as? String {
          result.insert(id)
        }
      }
      start += chunkSize
    }
    return result
  }

  private func currentWordbook() -> [[String: Any]] {
    let root = settingsRoot()
    let settings = root["settings"] as? [String: Any] ?? [:]
    let input = settings["input"] as? [String: Any] ?? [:]
    return normalizeWordbook(input["wordbook"] as? [[String: Any]] ?? [])
  }

  private func settingsRoot() -> [String: Any] {
    migratedSettingsRoot()
  }

  private func ensureRecordSchema() throws {
    try runSql("""
    CREATE TABLE IF NOT EXISTS transcription_records (
      id TEXT PRIMARY KEY,
      transcript TEXT NOT NULL,
      cleaned_text TEXT,
      user_correction TEXT,
      status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
      error TEXT,
      asr_provider TEXT,
      asr_model TEXT,
      cleanup_provider TEXT,
      cleanup_model TEXT,
      duration_ms INTEGER,
      asr_duration_ms INTEGER,
      cleanup_duration_ms INTEGER,
      total_tokens INTEGER,
      paste_succeeded INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transcription_records_created_at
      ON transcription_records(created_at DESC);
    """)
  }

  private func writeSettingsRoot(_ root: [String: Any]) throws {
    try writeSettingsRootFile(root)
  }

  private func runSql(_ sql: String) throws {
    try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
    let process = Process()
    let input = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
    process.arguments = ["-cmd", ".timeout 30000", recordDbFile.path]
    process.standardInput = input
    try process.run()
    if let data = sql.data(using: .utf8) {
      try? input.fileHandleForWriting.write(contentsOf: data)
    }
    try? input.fileHandleForWriting.close()
    process.waitUntilExit()
    if process.terminationStatus != 0 {
      throw NSError(domain: appName, code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: "sqlite3 failed"])
    }
  }

  private func runSqlJson(_ sql: String) throws -> [[String: Any]] {
    try FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    let process = Process()
    let input = Pipe()
    let outputURL = tempDir.appendingPathComponent("sqlite-json-\(UUID().uuidString).json")
    FileManager.default.createFile(atPath: outputURL.path, contents: nil)
    let output = try FileHandle(forWritingTo: outputURL)
    defer {
      try? output.close()
      try? FileManager.default.removeItem(at: outputURL)
    }
    process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
    process.arguments = ["-json", "-cmd", ".timeout 30000", recordDbFile.path]
    process.standardInput = input
    process.standardOutput = output
    try process.run()
    if let data = sql.data(using: .utf8) {
      try? input.fileHandleForWriting.write(contentsOf: data)
    }
    try? input.fileHandleForWriting.close()
    process.waitUntilExit()
    let data = (try? Data(contentsOf: outputURL)) ?? Data()
    if process.terminationStatus != 0 || data.isEmpty {
      return []
    }
    return (try JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
  }

  private func sqlString(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "''"))'"
  }

  private func sqlValue(_ value: Any?) -> String {
    if value == nil || value is NSNull {
      return "NULL"
    }
    if let text = value as? String {
      return text.isEmpty ? "NULL" : sqlString(text)
    }
    if let number = value as? NSNumber {
      return number.stringValue
    }
    if let int = value as? Int {
      return String(int)
    }
    if let bool = value as? Bool {
      return bool ? "1" : "0"
    }
    return sqlString(String(describing: value!))
  }

  private func sqlBool(_ value: Any?) -> String {
    if let bool = value as? Bool { return bool ? "1" : "0" }
    if let number = value as? NSNumber { return number.intValue == 0 ? "0" : "1" }
    return "NULL"
  }
}

func resolvePromptText(_ promptField: String) -> String {
  let trimmed = promptField.trimmingCharacters(in: .whitespacesAndNewlines)
  guard trimmed.hasPrefix("{"), trimmed.hasSuffix("}"),
        let data = trimmed.data(using: .utf8),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let prompts = json["prompts"] as? [String: Any] else {
    return trimmed.isEmpty ? defaultCleanupPrompt : promptField
  }
  let activeStyle = json["activeStyle"] as? String ?? "default"
  return prompts[activeStyle] as? String ?? promptField
}

func stripTerminalPunctuation(_ text: String) -> String {
  text.replacingOccurrences(of: #"[。．，、！？!?.,：:；;]+$"#, with: "", options: .regularExpression)
}

func countEffectiveChars(_ text: String) -> Int {
  Array(text.replacingOccurrences(of: #"\s+"#, with: "", options: .regularExpression)).count
}

func maskSensitive(_ text: String, apiKey: String) -> String {
  apiKey.isEmpty ? text : text.replacingOccurrences(of: apiKey, with: "***")
}

func cloudAsrTranscriptionURL(baseUrl: String) -> URL? {
  let trimmed = baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/").union(.whitespacesAndNewlines))
  guard !trimmed.isEmpty else { return nil }
  if trimmed.hasSuffix("/audio/transcriptions") {
    return URL(string: trimmed)
  }
  if trimmed.hasSuffix("/v1") {
    return URL(string: "\(trimmed)/audio/transcriptions")
  }
  return URL(string: "\(trimmed)/v1/audio/transcriptions")
}

func audioFileMeta(_ audio: Data) -> (filename: String, contentType: String) {
  if audio.count >= 12,
     String(data: audio.prefix(4), encoding: .ascii) == "RIFF",
     String(data: audio.dropFirst(8).prefix(4), encoding: .ascii) == "WAVE" {
    return ("audio.wav", "audio/wav")
  }
  if audio.first == 0x1A {
    return ("audio.webm", "audio/webm")
  }
  return ("audio.webm", "audio/webm")
}

func normalizedHeaderApiKey(_ apiKey: String) throws -> String {
  let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
  guard trimmed.range(of: #"[^\x20-\x7E]"#, options: .regularExpression) == nil else {
    throw NSError(domain: appName, code: 74, userInfo: [NSLocalizedDescriptionKey: "API Key 包含不可用于 HTTP Header 的字符，请检查是否复制了换行或中文字符"])
  }
  return trimmed
}

func fileSize(_ url: URL) -> Int {
  guard let values = try? url.resourceValues(forKeys: [.fileSizeKey]) else {
    return 0
  }
  return values.fileSize ?? 0
}

func string(_ value: Any?, fallback: String) -> String {
  guard let text = value as? String else { return fallback }
  let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed.isEmpty ? fallback : text
}

func formatRecordTime(_ value: String) -> String {
  guard let date = ISO8601DateFormatter().date(from: value) else {
    return value
  }
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "zh_CN")
  formatter.dateFormat = "yyyy/MM/dd HH:mm"
  return formatter.string(from: date)
}

func buildWordbookPrompt(_ entries: [WordbookEntry]) -> String {
  let items = entries.filter { !$0.target.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  guard !items.isEmpty else { return "" }
  let lines = items.map { entry -> String in
    let variants = entry.variants.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    if variants.isEmpty {
      return "- \(entry.target)"
    }
    return "- \(entry.target)（可能被识别为：\(variants.joined(separator: "、"))）"
  }
  return "\n\n专有名词词库（这些是用户的专有词汇，请确保在输出中使用正确的书写形式，若发现同音字或近似拼写请替换为正确写法）：\n\(lines.joined(separator: "\n"))"
}

func normalizeWordbook(_ entries: [[String: Any]]) -> [[String: Any]] {
  var result: [[String: Any]] = []
  var seen = Set<String>()
  for entry in entries {
    let target = string(entry["target"], fallback: "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !target.isEmpty else { continue }
    let key = target.lowercased()
    guard !seen.contains(key) else { continue }
    seen.insert(key)
    let variants = uniqueStrings((entry["variants"] as? [String] ?? []).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) })
    result.append([
      "id": string(entry["id"], fallback: "wordbook_\(key)"),
      "target": target,
      "variants": variants
    ])
  }
  return result
}

func mergeWordbookEntries(existing: [[String: Any]], imported: [[String: Any]]) -> [[String: Any]] {
  var merged = normalizeWordbook(existing)
  for entry in normalizeWordbook(imported) {
    let target = string(entry["target"], fallback: "")
    let key = target.lowercased()
    if let index = merged.firstIndex(where: { string($0["target"], fallback: "").lowercased() == key }) {
      let variants = (merged[index]["variants"] as? [String] ?? []) + (entry["variants"] as? [String] ?? [])
      merged[index]["variants"] = uniqueStrings(variants)
    } else {
      merged.append(entry)
    }
  }
  return merged
}

func mergeWordbookPairs(entries: [[String: Any]], pairs: [[String: String]]) -> (wordbook: [[String: Any]], addedPairs: [[String: String]]) {
  var wordbook = normalizeWordbook(entries)
  var added: [[String: String]] = []
  for pair in pairs {
    let from = string(pair["from"], fallback: "").trimmingCharacters(in: .whitespacesAndNewlines)
    let to = string(pair["to"], fallback: "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !from.isEmpty, !to.isEmpty, from.lowercased() != to.lowercased() else { continue }
    if let index = wordbook.firstIndex(where: { string($0["target"], fallback: "").lowercased() == to.lowercased() }) {
      var variants = wordbook[index]["variants"] as? [String] ?? []
      if !variants.contains(where: { $0.lowercased() == from.lowercased() }) {
        variants.append(from)
        wordbook[index]["variants"] = variants
        added.append(["from": from, "to": string(wordbook[index]["target"], fallback: to)])
      }
    } else {
      wordbook.append(["id": "wb_\(Int(Date().timeIntervalSince1970 * 1000))_snapsay", "target": to, "variants": [from]])
      added.append(["from": from, "to": to])
    }
  }
  return (wordbook, added)
}

func extractWordPairCandidates(original: String, corrected: String) -> [[String: String]] {
  let originalTokens = tokenizeForWordPairs(original)
  let correctedTokens = tokenizeForWordPairs(corrected)
  let lcs = computeLcs(originalTokens, correctedTokens)
  var pairs: [[String: String]] = []

  var originalIndex = 0
  var correctedIndex = 0
  var lcsIndex = 0

  while originalIndex < originalTokens.count || correctedIndex < correctedTokens.count {
    let originalWord = originalIndex < originalTokens.count ? originalTokens[originalIndex] : nil
    let correctedWord = correctedIndex < correctedTokens.count ? correctedTokens[correctedIndex] : nil
    let lcsWord = lcsIndex < lcs.count ? lcs[lcsIndex] : nil

    if let originalWord,
       let correctedWord,
       let lcsWord,
       originalWord.lowercased() == lcsWord.lowercased(),
       correctedWord.lowercased() == lcsWord.lowercased() {
      originalIndex += 1
      correctedIndex += 1
      lcsIndex += 1
      continue
    }

    var mismatchOriginal: [String] = []
    while originalIndex < originalTokens.count {
      let token = originalTokens[originalIndex]
      if let lcsWord, token.lowercased() == lcsWord.lowercased() {
        break
      }
      if !isStopToken(token) {
        mismatchOriginal.append(token)
      }
      originalIndex += 1
    }

    var mismatchCorrected: [String] = []
    while correctedIndex < correctedTokens.count {
      let token = correctedTokens[correctedIndex]
      if let lcsWord, token.lowercased() == lcsWord.lowercased() {
        break
      }
      if !isStopToken(token) {
        mismatchCorrected.append(token)
      }
      correctedIndex += 1
    }

    guard !mismatchOriginal.isEmpty, !mismatchCorrected.isEmpty else {
      continue
    }

    let isChinese = mismatchCorrected.contains { containsChinese($0) }
    if isChinese {
      var fromText = mismatchOriginal.joined()
      var toText = mismatchCorrected.joined()

      var rightCount = 0
      var rightOriginalIndex = originalIndex
      var rightCorrectedIndex = correctedIndex
      while rightCount < 3,
            rightOriginalIndex < originalTokens.count,
            rightCorrectedIndex < correctedTokens.count {
        let originalToken = originalTokens[rightOriginalIndex]
        let correctedToken = correctedTokens[rightCorrectedIndex]
        if originalToken.lowercased() == correctedToken.lowercased(),
           containsChinese(correctedToken),
           !isStopToken(correctedToken) {
          fromText += originalToken
          toText += correctedToken
          rightCount += 1
          rightOriginalIndex += 1
          rightCorrectedIndex += 1
        } else {
          break
        }
      }

      pairs.append(["from": fromText, "to": toText])
    } else {
      let context = collectSharedEnglishRightContext(
        originalTokens: originalTokens,
        correctedTokens: correctedTokens,
        originalIndex: originalIndex,
        correctedIndex: correctedIndex
      )
      let fromText = (mismatchOriginal + context.original).joined(separator: " ")
      let toText = (mismatchCorrected + context.corrected).joined(separator: " ")
      pairs.append(["from": fromText, "to": toText])
    }
  }

  return pairs.filter { pair in
    let from = string(pair["from"], fallback: "")
    let to = string(pair["to"], fallback: "")
    return !isStopToken(from) && !isStopToken(to) && from.lowercased() != to.lowercased()
  }
}

func tokenizeForWordPairs(_ text: String) -> [String] {
  let pattern = #"[\p{Han}]|[A-Za-z0-9_\-']+"#
  guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
  let range = NSRange(text.startIndex..<text.endIndex, in: text)
  return regex.matches(in: text, range: range).compactMap { match in
    guard let tokenRange = Range(match.range, in: text) else { return nil }
    return String(text[tokenRange])
  }
}

func collectSharedEnglishRightContext(
  originalTokens: [String],
  correctedTokens: [String],
  originalIndex: Int,
  correctedIndex: Int
) -> (original: [String], corrected: [String]) {
  var original: [String] = []
  var corrected: [String] = []
  var oi = originalIndex
  var ci = correctedIndex
  while original.count < 2, oi < originalTokens.count, ci < correctedTokens.count {
    let originalToken = originalTokens[oi]
    let correctedToken = correctedTokens[ci]
    guard isEnglishPhraseToken(originalToken),
          isEnglishPhraseToken(correctedToken),
          originalToken.lowercased() == correctedToken.lowercased() else {
      break
    }
    original.append(originalToken)
    corrected.append(correctedToken)
    oi += 1
    ci += 1
  }
  return (original, corrected)
}

func isEnglishPhraseToken(_ token: String) -> Bool {
  guard token.range(of: #"^[A-Za-z0-9][A-Za-z0-9\-_']*$"#, options: .regularExpression) != nil else {
    return false
  }
  return token.range(of: #"^\d+$"#, options: .regularExpression) == nil
}

func isStopToken(_ token: String) -> Bool {
  let stops: Set<String> = [
    "的", "了", "是", "在", "和", "与", "或", "也", "都", "就", "但", "而",
    "这", "那", "有", "没", "不", "很", "我", "你", "他", "她", "它", "们",
    "个", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"
  ]
  return stops.contains(token) || token.range(of: #"^\d+$"#, options: .regularExpression) != nil
}

func containsChinese(_ token: String) -> Bool {
  token.range(of: #"[\p{Han}]"#, options: .regularExpression) != nil
}

func computeLcs(_ a: [String], _ b: [String]) -> [String] {
  let m = a.count
  let n = b.count
  var dp = Array(repeating: Array(repeating: 0, count: n + 1), count: m + 1)

  if m > 0, n > 0 {
    for i in 1...m {
      for j in 1...n {
        if a[i - 1].lowercased() == b[j - 1].lowercased() {
          dp[i][j] = dp[i - 1][j - 1] + 1
        } else {
          dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
        }
      }
    }
  }

  var result: [String] = []
  var i = m
  var j = n
  while i > 0, j > 0 {
    if a[i - 1].lowercased() == b[j - 1].lowercased() {
      result.insert(a[i - 1], at: 0)
      i -= 1
      j -= 1
    } else if dp[i - 1][j] > dp[i][j - 1] {
      i -= 1
    } else {
      j -= 1
    }
  }
  return result
}

func uniqueStrings(_ values: [String]) -> [String] {
  var seen = Set<String>()
  var result: [String] = []
  for value in values {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    let key = trimmed.lowercased()
    if !trimmed.isEmpty, !seen.contains(key) {
      seen.insert(key)
      result.append(trimmed)
    }
  }
  return result
}

func normalizeRecordStatus(_ value: Any?) -> String {
  let text = string(value, fallback: "completed").lowercased()
  if text == "failed" || text == "失败" {
    return "failed"
  }
  return "completed"
}

private extension Data {
  mutating func appendString(_ value: String) {
    if let data = value.data(using: .utf8) {
      append(data)
    }
  }
}

private extension Date {
  var isoDateOnly: String {
    ISO8601DateFormatter().string(from: self).prefix(10).description
  }

  func millisecondsSince(_ earlier: Date) -> Int {
    max(0, Int(timeIntervalSince(earlier) * 1000))
  }
}

final class ASRDaemonClient: @unchecked Sendable {
  private let portFile: URL

  init(portFile: URL) {
    self.portFile = portFile
  }

  func transcribe(audio: Data) async throws -> String {
    let portText = try String(contentsOf: portFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    guard let port = UInt32(portText) else { throw NSError(domain: appName, code: 10) }
    return try await withCheckedThrowingContinuation { continuation in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let result = try self.transcribeSync(audio: audio, port: port)
          continuation.resume(returning: result)
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func transcribeSync(audio: Data, port: UInt32) throws -> String {
    var readStream: Unmanaged<CFReadStream>?
    var writeStream: Unmanaged<CFWriteStream>?
    CFStreamCreatePairWithSocketToHost(kCFAllocatorDefault, "127.0.0.1" as CFString, port, &readStream, &writeStream)
    guard let input = readStream?.takeRetainedValue() as InputStream?,
          let output = writeStream?.takeRetainedValue() as OutputStream? else {
      throw NSError(domain: appName, code: 15)
    }
    input.open()
    output.open()
    defer {
      input.close()
      output.close()
    }

    var length = UInt32(audio.count).bigEndian
    let header = Data(bytes: &length, count: 4)
    try write(header, to: output)
    try write(audio, to: output)

    var buffer = [UInt8](repeating: 0, count: 4096)
    var response = Data()
    let deadline = Date().addingTimeInterval(60)
    while Date() < deadline {
      let count = input.read(&buffer, maxLength: buffer.count)
      if count > 0 {
        response.append(buffer, count: count)
        if response.contains(0x0A) { break }
      } else if count < 0 {
        throw input.streamError ?? NSError(domain: appName, code: 11)
      } else {
        Thread.sleep(forTimeInterval: 0.05)
      }
    }
    guard let line = String(data: response, encoding: .utf8)?.split(separator: "\n").first,
          let jsonData = line.data(using: .utf8),
          let json = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
      throw NSError(domain: appName, code: 12)
    }
    if let error = json["error"] as? String { throw NSError(domain: appName, code: 13, userInfo: [NSLocalizedDescriptionKey: error]) }
    return json["text"] as? String ?? ""
  }

  private func write(_ data: Data, to stream: OutputStream) throws {
    try data.withUnsafeBytes { bytes in
      guard let base = bytes.bindMemory(to: UInt8.self).baseAddress else { return }
      var offset = 0
      while offset < data.count {
        let written = stream.write(base.advanced(by: offset), maxLength: data.count - offset)
        if written <= 0 { throw stream.streamError ?? NSError(domain: appName, code: 14) }
        offset += written
      }
    }
  }
}

enum SettingsOpener {
  static func openMicrophone() {
    open([
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
    ])
  }

  static func openAccessibility() {
    open([
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility",
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    ])
  }

  private static func open(_ urls: [String]) {
    for value in urls {
      if let url = URL(string: value), NSWorkspace.shared.open(url) {
        appLog("opened settings url=\(value)")
        return
      }
    }
    appLog("failed to open system settings")
  }
}

final class PasteController {
  func paste(text: String, restoreClipboard: Bool = true, asyncRestore: Bool = true) throws {
    let pasteboard = NSPasteboard.general
    let snapshot = PasteboardSnapshot.capture(from: pasteboard)
    pasteboard.clearContents()
    pasteboard.setString(text, forType: .string)
    let insertedChangeCount = pasteboard.changeCount

    guard AXIsProcessTrusted() else {
      if restoreClipboard {
        snapshot.restore(to: pasteboard)
      }
      let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
      _ = AXIsProcessTrustedWithOptions(options)
      SettingsOpener.openAccessibility()
      throw NSError(domain: appName, code: 20, userInfo: [NSLocalizedDescriptionKey: "需要辅助功能权限"])
    }

    let source = CGEventSource(stateID: .combinedSessionState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: false)
    down?.flags = .maskCommand
    up?.flags = .maskCommand
    down?.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.05)
    up?.post(tap: .cghidEventTap)
    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.25))

    if restoreClipboard {
      let restore = {
        let pasteboard = NSPasteboard.general
        if pasteboard.changeCount == insertedChangeCount {
          snapshot.restore(to: pasteboard)
          appLog("pasteboard restored after paste")
        } else {
          appLog("pasteboard not restored because it changed after paste")
        }
      }
      if asyncRestore {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0, execute: restore)
      } else {
        Thread.sleep(forTimeInterval: 2.0)
        restore()
      }
    }
  }
}

struct PasteboardSnapshot {
  private let items: [NSPasteboardItem]

  static func capture(from pasteboard: NSPasteboard) -> PasteboardSnapshot {
    let copiedItems = (pasteboard.pasteboardItems ?? []).map { item in
      let copy = NSPasteboardItem()
      for type in item.types {
        if let data = item.data(forType: type) {
          copy.setData(data, forType: type)
        }
      }
      return copy
    }
    return PasteboardSnapshot(items: copiedItems)
  }

  func restore(to pasteboard: NSPasteboard) {
    pasteboard.clearContents()
    if !items.isEmpty {
      pasteboard.writeObjects(items)
    }
  }
}

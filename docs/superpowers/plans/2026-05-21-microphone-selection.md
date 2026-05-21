# Microphone Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings dropdown that lets users record with the system default microphone or a selected audio input device.

**Architecture:** Store a `microphoneDeviceId` string in existing settings. Enumerate microphone devices in the renderer with browser MediaDevices APIs. Use the selected id to build the `getUserMedia` audio constraint at recording time.

**Tech Stack:** React 19, Electron preload IPC, TypeScript, Vitest, Testing Library, browser `navigator.mediaDevices`.

---

### Task 1: Persist Microphone Selection

**Files:**
- Modify: `src/main/settingsStore.ts`
- Modify: `src/main/main.ts`
- Test: `tests/settingsStore.test.ts`

- [ ] **Step 1: Write the failing store test**

Add assertions that `store.getSettings().input.microphoneDeviceId` defaults to `''`, and that `saveSettings({ input: { microphoneDeviceId: 'mic-2' } })` persists `mic-2`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/settingsStore.test.ts`

- [ ] **Step 3: Add the setting field**

Add `microphoneDeviceId: string` to `AppSettings.input`, `defaultSettings.input`, and pass it through `RendererSettings`, `toRendererSettings`, and `saveSettings`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/settingsStore.test.ts`

### Task 2: Renderer Dropdown And Recording Constraint

**Files:**
- Modify: `src/renderer/App.tsx`
- Test: `tests/app-render.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

Test that Settings shows a `麦克风` dropdown defaulting to `系统默认麦克风`, lists mocked audio input devices, saves a selected device id, and recording uses `{ audio: { deviceId: { exact: 'mic-2' } } }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/app-render.test.tsx`

- [ ] **Step 3: Implement minimal renderer behavior**

Add a `MicrophoneDevice` type, enumerate devices with `navigator.mediaDevices.enumerateDevices`, render a `CustomSelect`, update `microphoneDeviceId`, and build the `getUserMedia` constraint from settings.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/app-render.test.tsx`

### Task 3: Final Verification And Commit

**Files:**
- Verify all modified source, tests, and docs.

- [ ] **Step 1: Run full verification**

Run: `npm test -- --runInBand` if supported, otherwise `npm test`, then `npm run typecheck`.

- [ ] **Step 2: Inspect git diff**

Run: `git diff --stat` and `git diff --check`.

- [ ] **Step 3: Commit**

Run: `git add docs/superpowers/specs/2026-05-21-microphone-selection-design.md docs/superpowers/plans/2026-05-21-microphone-selection.md src/main/settingsStore.ts src/main/main.ts src/renderer/App.tsx tests/settingsStore.test.ts tests/app-render.test.tsx && git commit -m "feat: add microphone selection setting"`.

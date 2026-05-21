# Microphone Selection Design

## Goal

Settings must let users keep the system default microphone or choose another available microphone for browser-based recording.

## Behavior

- The Settings page adds a microphone dropdown in the existing input settings area.
- The first option is `系统默认麦克风` and stores an empty `microphoneDeviceId`.
- Other options come from `navigator.mediaDevices.enumerateDevices()` filtered to `audioinput`.
- If labels are hidden before permission is granted, options fall back to `麦克风 1`, `麦克风 2`, etc.
- Recording uses `{ audio: true }` for the default option and `{ audio: { deviceId: { exact: selectedId } } }` for a selected microphone.
- If the saved device is missing from the current device list, the dropdown still displays it as `已保存的麦克风` until the user picks another device.

## Data Flow

- `SettingsState.microphoneDeviceId` is loaded from and saved to `settings.input.microphoneDeviceId`.
- `main.ts` includes the field in renderer settings and persists it through `saveSettings`.
- `settingsStore.ts` defaults the value to an empty string and merges legacy settings safely.
- `App.tsx` enumerates devices in the renderer and passes the selected device to `getUserMedia`.

## Testing

- Renderer tests verify the dropdown defaults to system microphone and saves a selected device.
- Renderer tests verify recording requests the selected `deviceId`.
- Store tests verify the new field defaults and persists.

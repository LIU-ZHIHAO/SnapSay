import { describe, expect, it, vi } from 'vitest';
import {
  classifyPressDuration,
  pasteTextToCursor,
  parseTriggerLabelToAccelerator,
  parseTriggerLabelToBinding,
  registerKeyboardTrigger,
  registerMouseTrigger,
  triggerToAccelerator
} from '../src/main/inputController';
import { createMockAsrProvider } from '../src/main/providers';
import { createMemoryStore, createSettingsStore } from '../src/main/settingsStore';
import { runRecordingPipeline } from '../src/main/recorderCoordinator';
import {
  createFloatingWindow,
  hideFloatingWindow,
  updateFloatingState
} from '../src/main/floatingWindow';

describe('inputController', () => {
  it('converts trigger config to Electron accelerators', () => {
    expect(
      triggerToAccelerator({
        key: 'space',
        modifiers: ['ctrl', 'shift']
      })
    ).toBe('CommandOrControl+Shift+Space');

    expect(triggerToAccelerator({ key: 'f9', modifiers: [] })).toBe('F9');
  });

  it('parses saved trigger labels into Electron accelerators', () => {
    expect(parseTriggerLabelToAccelerator('F9')).toBe('F9');
    expect(parseTriggerLabelToAccelerator('Ctrl + Alt + V')).toBe('CommandOrControl+Alt+V');
    expect(parseTriggerLabelToAccelerator('Mouse Middle')).toBeUndefined();
  });

  it('parses trigger labels into keyboard or mouse bindings', () => {
    expect(parseTriggerLabelToBinding('左 Ctrl + 左 Win')).toEqual({
      type: 'keyboard',
      key: 'Meta',
      modifiers: ['control']
    });
    expect(parseTriggerLabelToBinding('Ctrl + Alt + V')).toEqual({
      type: 'keyboard',
      key: 'V',
      modifiers: ['control', 'alt']
    });
    expect(parseTriggerLabelToBinding('Mouse Middle')).toEqual({
      type: 'mouse',
      button: 'middle'
    });
    expect(parseTriggerLabelToBinding('Mouse Side 2')).toEqual({
      type: 'mouse',
      button: 'x2'
    });
  });

  it('classifies shortcut press duration for short and long actions', () => {
    expect(classifyPressDuration(1000, 1249, 350)).toBe('short');
    expect(classifyPressDuration(1000, 1350, 350)).toBe('long');
  });

  it('registers keyboard triggers through an injected adapter', () => {
    const unregister = vi.fn();
    const adapter = {
      register: vi.fn().mockReturnValue(unregister)
    };
    const handler = vi.fn();

    const result = registerKeyboardTrigger(
      { key: 'f9', modifiers: ['alt'] },
      handler,
      adapter
    );

    expect(result).toEqual({ status: 'registered', accelerator: 'Alt+F9', unregister });
    expect(adapter.register).toHaveBeenCalledWith('Alt+F9', handler);
  });

  it('pastes text through an injected clipboard and keyboard adapter', async () => {
    const clipboard = { writeText: vi.fn() };
    const keyboard = { pressPasteShortcut: vi.fn().mockResolvedValue(undefined) };

    await expect(
      pasteTextToCursor('clean text', { clipboard, keyboard })
    ).resolves.toEqual({ status: 'pasted' });

    expect(clipboard.writeText).toHaveBeenCalledWith('clean text');
    expect(keyboard.pressPasteShortcut).toHaveBeenCalled();
  });

  it('returns unsupported when mouse hook adapter is missing', () => {
    expect(registerMouseTrigger({ button: 'middle' }, vi.fn())).toEqual({
      status: 'unsupported',
      reason: 'mouse hook adapter unavailable'
    });
  });
});

describe('recorderCoordinator', () => {
  it('saves a completed record after ASR, cleanup, and paste', async () => {
    const store = createSettingsStore({ store: createMemoryStore() });
    const cleanup = vi.fn().mockResolvedValue('clean text');
    const paste = vi.fn().mockResolvedValue({ status: 'pasted' });

    const record = await runRecordingPipeline({
      audio: new ArrayBuffer(0),
      asrProvider: createMockAsrProvider('raw text'),
      cleanupText: cleanup,
      pasteText: paste,
      settingsStore: store
    });

    expect(record.status).toBe('completed');
    expect(record.cleanedText).toBe('clean text');
    expect(cleanup).toHaveBeenCalledWith('raw text');
    expect(paste).toHaveBeenCalledWith('clean text');
    expect(store.listRecords()[0]).toEqual(record);
  });

  it('saves a failed record when cleanup fails', async () => {
    const store = createSettingsStore({ store: createMemoryStore() });

    const record = await runRecordingPipeline({
      audio: new ArrayBuffer(0),
      asrProvider: createMockAsrProvider('raw text'),
      cleanupText: vi.fn().mockRejectedValue(new Error('cleanup failed')),
      pasteText: vi.fn(),
      settingsStore: store
    });

    expect(record.status).toBe('failed');
    expect(record.transcript).toBe('raw text');
    expect(record.error).toContain('cleanup failed');
    expect(store.listRecords()[0]).toEqual(record);
  });

  it('preserves cleaned text when paste fails', async () => {
    const store = createSettingsStore({ store: createMemoryStore() });

    const record = await runRecordingPipeline({
      audio: new ArrayBuffer(0),
      asrProvider: createMockAsrProvider('raw text'),
      cleanupText: vi.fn().mockResolvedValue('clean text'),
      pasteText: vi.fn().mockRejectedValue(new Error('paste failed')),
      settingsStore: store
    });

    expect(record.status).toBe('failed');
    expect(record.transcript).toBe('raw text');
    expect(record.cleanedText).toBe('clean text');
    expect(record.pasteSucceeded).toBe(false);
    expect(store.listRecords()[0]).toEqual(record);
  });
});

describe('floatingWindow', () => {
  it('creates, updates, and hides the floating window through an adapter', () => {
    const send = vi.fn();
    const show = vi.fn();
    const hide = vi.fn();
    const window = {
      hide,
      show,
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { send }
    };
    const factory = vi.fn().mockReturnValue(window);

    expect(createFloatingWindow(factory)).toBe(window);
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        alwaysOnTop: true,
        backgroundColor: '#00000000',
        frame: false,
        focusable: false,
        show: false
      })
    );

    expect(updateFloatingState({ visible: true, recording: true, transcript: 'raw' })).toBe(true);
    expect(send).toHaveBeenCalledWith('floating-state:update', {
      visible: true,
      recording: true,
      transcript: 'raw'
    });
    expect(show).toHaveBeenCalled();

    expect(hideFloatingWindow()).toBe(true);
    expect(hide).toHaveBeenCalled();
  });
});

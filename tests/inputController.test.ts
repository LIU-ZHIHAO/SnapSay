import { describe, expect, it, vi } from 'vitest';
import {
  pasteTextToCursor,
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
        frame: false,
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

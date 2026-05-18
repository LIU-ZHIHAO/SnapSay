export type TriggerModifier = 'ctrl' | 'control' | 'cmd' | 'command' | 'shift' | 'alt' | 'option' | 'meta';

export type KeyboardTrigger = {
  key: string;
  modifiers: TriggerModifier[];
};

export type KeyboardAdapter = {
  register(accelerator: string, handler: () => void): () => void;
};

export type ClipboardAdapter = {
  writeText(text: string): void;
};

export type PasteKeyboardAdapter = {
  pressPasteShortcut(): Promise<void> | void;
};

export type MouseTrigger = {
  button: 'left' | 'right' | 'middle' | 'x1' | 'x2';
};

export type MouseHookAdapter = {
  register(trigger: MouseTrigger, handler: () => void): () => void;
};

export function triggerToAccelerator(trigger: KeyboardTrigger): string {
  const parts = [
    ...trigger.modifiers.map(normalizeModifier),
    normalizeKey(trigger.key)
  ].filter(Boolean);
  return parts.join('+');
}

export function registerKeyboardTrigger(
  trigger: KeyboardTrigger,
  handler: () => void,
  adapter: KeyboardAdapter
):
  | { status: 'registered'; accelerator: string; unregister: () => void }
  | { status: 'unsupported'; reason: string } {
  const accelerator = triggerToAccelerator(trigger);
  if (!accelerator) {
    return { status: 'unsupported', reason: 'empty keyboard trigger' };
  }
  return {
    status: 'registered',
    accelerator,
    unregister: adapter.register(accelerator, handler)
  };
}

export async function pasteTextToCursor(
  text: string,
  adapters: {
    clipboard: ClipboardAdapter;
    keyboard: PasteKeyboardAdapter;
  }
): Promise<{ status: 'pasted' }> {
  adapters.clipboard.writeText(text);
  await adapters.keyboard.pressPasteShortcut();
  return { status: 'pasted' };
}

export function registerMouseTrigger(
  trigger: MouseTrigger,
  handler: () => void,
  adapter?: MouseHookAdapter
):
  | { status: 'registered'; unregister: () => void }
  | { status: 'unsupported'; reason: string } {
  if (!adapter) {
    return {
      status: 'unsupported',
      reason: 'mouse hook adapter unavailable'
    };
  }
  return {
    status: 'registered',
    unregister: adapter.register(trigger, handler)
  };
}

function normalizeModifier(modifier: TriggerModifier): string {
  switch (modifier) {
    case 'ctrl':
    case 'control':
      return 'CommandOrControl';
    case 'cmd':
    case 'command':
    case 'meta':
      return 'Command';
    case 'shift':
      return 'Shift';
    case 'alt':
    case 'option':
      return 'Alt';
    default:
      return modifier;
  }
}

function normalizeKey(key: string): string {
  const normalized = key.trim();
  if (/^f\d{1,2}$/i.test(normalized)) {
    return normalized.toUpperCase();
  }
  if (normalized.length === 1) {
    return normalized.toUpperCase();
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
}

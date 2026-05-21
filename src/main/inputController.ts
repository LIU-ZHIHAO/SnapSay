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

export type TriggerBinding =
  | { type: 'keyboard'; key: string; modifiers: TriggerModifier[] }
  | { type: 'mouse'; button: MouseTrigger['button'] };

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

export function parseTriggerLabelToAccelerator(label: string): string | undefined {
  const binding = parseTriggerLabelToBinding(label);
  if (!binding || binding.type !== 'keyboard') {
    return undefined;
  }

  return triggerToAccelerator(binding);
}

export function parseTriggerLabelToBinding(label: string): TriggerBinding | undefined {
  const normalized = label.trim();
  if (!normalized) {
    return undefined;
  }

  if (/^mouse middle$/i.test(normalized) || normalized === '鼠标中键') {
    return { type: 'mouse', button: 'middle' };
  }
  if (/^mouse left$/i.test(normalized) || normalized === '鼠标左键') {
    return { type: 'mouse', button: 'left' };
  }
  if (/^mouse right$/i.test(normalized) || normalized === '鼠标右键') {
    return { type: 'mouse', button: 'right' };
  }
  if (/^mouse side 1$/i.test(normalized) || normalized === '鼠标侧键1') {
    return { type: 'mouse', button: 'x1' };
  }
  if (/^mouse side 2$/i.test(normalized) || normalized === '鼠标侧键2') {
    return { type: 'mouse', button: 'x2' };
  }

  const parts = normalized
    .split('+')
    .map(normalizeLabelPart)
    .filter(Boolean);
  const key = parts.pop();
  if (!key) {
    return undefined;
  }

  return {
    type: 'keyboard',
    key,
    modifiers: parts.map((part) => part.toLowerCase() as TriggerModifier)
  };
}

export function classifyPressDuration(startedAt: number, endedAt: number, longPressMs = 350): 'short' | 'long' {
  return endedAt - startedAt >= longPressMs ? 'long' : 'short';
}

export function resolveTriggerReleaseAction(options: {
  wasRecordingAtDown: boolean;
  startedAt: number;
  endedAt: number;
  longPressMs?: number;
}): 'keep-recording' | 'stop-recording' {
  if (options.wasRecordingAtDown) {
    return 'stop-recording';
  }
  return classifyPressDuration(options.startedAt, options.endedAt, options.longPressMs) === 'long'
    ? 'stop-recording'
    : 'keep-recording';
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

function normalizeLabelPart(part: string): string {
  const normalized = part.trim();
  switch (normalized.toLowerCase()) {
    case '左 ctrl':
    case '右 ctrl':
    case 'ctrl':
    case 'control':
      return 'control';
    case '左 alt':
    case '右 alt':
    case 'alt':
    case 'option':
      return 'alt';
    case '左 shift':
    case '右 shift':
    case 'shift':
      return 'shift';
    case '左 win':
    case '右 win':
    case 'win':
    case 'windows':
    case 'meta':
    case 'cmd':
    case 'command':
      return 'Meta';
    default:
      return normalizeKey(normalized);
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

export type FloatingState = {
  visible: boolean;
  recording: boolean;
  status?: 'recording' | 'recognizing' | 'rewriting' | 'done' | 'failed';
  transcript?: string;
  error?: string;
};

export type FloatingBrowserWindow = {
  hide(): void;
  show(): void;
  isDestroyed(): boolean;
  webContents: {
    send(channel: string, payload: unknown): void;
  };
};

export type FloatingWindowFactory = (options: {
  width: number;
  height: number;
  frame: boolean;
  resizable: boolean;
  alwaysOnTop: boolean;
  skipTaskbar: boolean;
  transparent: boolean;
  backgroundColor: string;
  show: boolean;
  focusable: boolean;
}) => FloatingBrowserWindow;

let floatingWindow: FloatingBrowserWindow | undefined;

export function createFloatingWindow(factory: FloatingWindowFactory): FloatingBrowserWindow {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    return floatingWindow;
  }

  floatingWindow = factory({
    width: 160,
    height: 40,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    focusable: false
  });

  return floatingWindow;
}

export function updateFloatingState(state: FloatingState): boolean {
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    return false;
  }

  floatingWindow.webContents.send('floating-state:update', state);
  if (state.visible) {
    floatingWindow.show();
  } else {
    floatingWindow.hide();
  }
  return true;
}

export function hideFloatingWindow(): boolean {
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    return false;
  }
  floatingWindow.hide();
  return true;
}

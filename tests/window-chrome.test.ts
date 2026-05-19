import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('custom window chrome', () => {
  it('creates the main window without the native frame or menu bar', () => {
    const mainSource = readFileSync(join(process.cwd(), 'src', 'main', 'main.ts'), 'utf8');

    expect(mainSource).toMatch(/frame:\s*false/);
    expect(mainSource).toMatch(/autoHideMenuBar:\s*true/);
    expect(mainSource).toMatch(/titleBarStyle:\s*['"]hidden['"]/);
    expect(mainSource).toContain('Menu.setApplicationMenu(null)');
  });

  it('exposes window control actions through the preload bridge', () => {
    const preloadSource = readFileSync(join(process.cwd(), 'src', 'main', 'preload.ts'), 'utf8');

    expect(preloadSource).toContain('windowControl');
    expect(preloadSource).toContain('tailkall:window-control');
  });

  it('integrates the draggable chrome into the app shell while keeping buttons interactive', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'renderer', 'styles.css'), 'utf8');

    expect(css).not.toContain('.window-titlebar');
    expect(css).toMatch(/\.app-shell\s*\{[^}]*app-region:\s*drag/s);
    expect(css).toMatch(/\.window-controls button\s*\{[^}]*app-region:\s*no-drag/s);
  });
});

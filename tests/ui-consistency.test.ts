import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('TailKall UI consistency', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'renderer', 'styles.css'), 'utf8');
  const appSource = readFileSync(join(process.cwd(), 'src', 'renderer', 'App.tsx'), 'utf8');

  it('uses a unified Windows client design system by default', () => {
    expect(css).toMatch(/:root\s*\{[^}]*--bg-base:\s*#f6f7f9/s);
    expect(css).toMatch(/:root\s*\{[^}]*--surface-sidebar:\s*#f7f8fa/s);
    expect(css).toMatch(/:root\s*\{[^}]*--radius-panel:\s*18px/s);
    expect(appSource).not.toContain('ThemeSwitcher');
    expect(appSource).not.toContain('tailkall-theme');
  });

  it('keeps four appearance styles on token overrides instead of duplicate component skins', () => {
    for (const style of ['light', 'dark', 'pink', 'green']) {
      expect(css).toContain(`[data-appearance="${style}"]`);
    }
    expect(css).toMatch(/\[data-appearance="dark"\]\s*\{[^}]*--bg-base:/s);
    expect(css).toMatch(/\[data-appearance="pink"\]\s*\{[^}]*--accent:/s);
    expect(css).toMatch(/\[data-appearance="green"\]\s*\{[^}]*--accent:/s);
    expect(appSource).toContain('AppearanceSelector');
    expect(appSource).toContain('tailkall-appearance');
  });

  it('does not contain legacy mixed-style hardcoded colors from the old UI', () => {
    for (const legacyColor of ['#5d6f67', '#12352d', '#edf7f2', '#cae1d7', '#fff0f0', '#8f1d1d']) {
      expect(css).not.toContain(legacyColor);
    }
  });

  it('keeps settings, wordbook, and correction controls on shared component styles', () => {
    expect(css).toMatch(/\.settings-card\s*\{/);
    expect(css).toMatch(/\.setting-row\s*\{/);
    expect(css).toMatch(/\.switch-control\s*\{/);
    expect(css).toMatch(/\.wordbook-add-row\s*\{[^}]*background:\s*var\(--surface-muted\)/s);
    expect(css).toMatch(/\.correction-area\s*\{[^}]*background:\s*var\(--surface-muted\)/s);
  });
});

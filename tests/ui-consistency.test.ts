import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SnapSay UI consistency', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'renderer', 'styles.css'), 'utf8');
  const appSource = readFileSync(join(process.cwd(), 'src', 'renderer', 'App.tsx'), 'utf8');
  const modelsSource = readFileSync(join(process.cwd(), 'src', 'renderer', 'ModelsView.tsx'), 'utf8');

  it('uses a unified Windows client design system by default', () => {
    expect(css).toMatch(/:root\s*\{[^}]*--bg-base:\s*#f6f7f9/s);
    expect(css).toMatch(/:root\s*\{[^}]*--surface-sidebar:\s*#f7f8fa/s);
    expect(css).toMatch(/:root\s*\{[^}]*--radius-panel:\s*18px/s);
    expect(appSource).not.toContain('ThemeSwitcher');
    expect(appSource).not.toContain('snapsay-theme');
  });

  it('keeps four appearance styles on token overrides instead of duplicate component skins', () => {
    for (const style of ['light', 'dark', 'pink', 'green']) {
      expect(css).toContain(`[data-appearance="${style}"]`);
    }
    expect(css).toMatch(/\[data-appearance="dark"\]\s*\{[^}]*--bg-base:/s);
    expect(css).toMatch(/\[data-appearance="pink"\]\s*\{[^}]*--accent:/s);
    expect(css).toMatch(/\[data-appearance="green"\]\s*\{[^}]*--accent:/s);
    expect(appSource).toContain('AppearanceSelector');
    expect(appSource).toContain('snapsay-appearance');
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

  it('keeps the models page in a scrollable content flow with compact provider cards', () => {
    expect(css).toMatch(/\.settings-view\s*\{[^}]*max-width:\s*980px/s);
    expect(css).not.toMatch(/\.settings-view\s*\{[^}]*border:\s*1px solid var\(--border-subtle\)/s);
    expect(css).not.toMatch(/\.settings-view\s*\{[^}]*box-shadow:\s*var\(--shadow-panel\)/s);
    expect(css).not.toMatch(/\.asr-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
    expect(modelsSource).not.toContain('provider-card-fields');
  });
});

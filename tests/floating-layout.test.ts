import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('floating capsule layout styles', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'renderer', 'styles.css'), 'utf8');

  it('keeps the floating capsule text on one line with stable width', () => {
    expect(css).toMatch(/\.floating-capsule\s*\{[^}]*width:\s*300px/s);
    expect(css).toMatch(/\.floating-capsule\s*\{[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/\.floating-title\s*\{[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/\.floating-state\s*\{[^}]*white-space:\s*nowrap/s);
  });

  it('overrides the main app body constraints for the floating page', () => {
    expect(css).toMatch(/html\.floating-page\s*\{[^}]*background:\s*transparent/s);
    expect(css).toMatch(/body\.floating-page\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/body\.floating-page\s*\{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/body\.floating-page\s*\{[^}]*background:\s*transparent/s);
    expect(css).toMatch(/html\.floating-page\s+body\.floating-page\s+#root\s*\{[^}]*background:\s*transparent/s);
  });
});

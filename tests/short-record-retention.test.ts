import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('short transcript record retention', () => {
  it('does not delete records only because the transcript is shorter than five characters', () => {
    const mainSource = readFileSync(join(process.cwd(), 'src', 'main', 'main.ts'), 'utf8');

    expect(mainSource).not.toMatch(/transcript\.length\s*<\s*5[\s\S]{0,200}deleteRecord\(record\.id\)/);
  });
});

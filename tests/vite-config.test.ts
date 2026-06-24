// @vitest-environment node

import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

describe('vite production config', () => {
  it('uses relative asset paths so the native WebView can load renderer bundles', () => {
    expect(viteConfig).toMatchObject({
      base: './'
    });
  });
});

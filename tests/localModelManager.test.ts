// @vitest-environment node

import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocalModelStatus, getModelDownloadHeaders } from '../src/main/localModelManager';

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('local ONNX model manager', () => {
  it('reports missing SenseVoice ONNX files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snapsay-model-missing-'));
    tempDirs.push(dir);

    const status = getLocalModelStatus(dir);

    expect(status.installed).toBe(false);
    expect(status.missingFiles).toEqual(['model.onnx', 'tokens.json', 'am.mvn']);
    expect(status.modelDir).toBe(dir);
  });

  it('reports installed when the required ONNX files exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snapsay-model-installed-'));
    tempDirs.push(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'model.onnx'), 'onnx');
    writeFileSync(join(dir, 'tokens.json'), '[]');
    writeFileSync(join(dir, 'am.mvn'), '<AddShift>');

    const status = getLocalModelStatus(dir);

    expect(status.installed).toBe(true);
    expect(status.missingFiles).toEqual([]);
    expect(status.requiredFiles.map((file) => file.name)).toEqual(['model.onnx', 'tokens.json', 'am.mvn']);
  });

  it('uses browser-like headers for ModelScope CDN downloads', () => {
    const headers = getModelDownloadHeaders();

    expect(headers['User-Agent']).toContain('Mozilla/5.0');
    expect(headers.Accept).toContain('application/octet-stream');
    expect(headers.Referer).toContain('modelscope.cn');
  });
});

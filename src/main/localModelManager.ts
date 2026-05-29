import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { get } from 'node:https';
import { shell } from 'electron';

export type LocalModelFileStatus = {
  name: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
};

export type LocalModelStatus = {
  installed: boolean;
  modelDir: string;
  requiredFiles: LocalModelFileStatus[];
  missingFiles: string[];
};

export type LocalModelDownloadResult = LocalModelStatus & {
  ok: boolean;
  message: string;
};

type DownloadFile = {
  url: string;
  targetName: string;
  minBytes: number;
};

const SENSEVOICE_ONNX_FILES: DownloadFile[] = [
  {
    url: 'https://www.modelscope.cn/models/iic/SenseVoiceSmall-onnx/resolve/master/model_quant.onnx',
    targetName: 'model.onnx',
    minBytes: 10 * 1024 * 1024
  },
  {
    url: 'https://www.modelscope.cn/models/iic/SenseVoiceSmall-onnx/resolve/master/tokens.json',
    targetName: 'tokens.json',
    minBytes: 1024
  },
  {
    url: 'https://www.modelscope.cn/models/iic/SenseVoiceSmall-onnx/resolve/master/am.mvn',
    targetName: 'am.mvn',
    minBytes: 1024
  }
];

const REQUIRED_FILE_NAMES = SENSEVOICE_ONNX_FILES.map((file) => file.targetName);

export function getLocalModelStatus(modelDir: string): LocalModelStatus {
  const requiredFiles = REQUIRED_FILE_NAMES.map((name) => {
    const path = join(modelDir, name);
    const exists = existsSync(path);
    const sizeBytes = exists ? statSync(path).size : 0;
    return { name, path, exists, sizeBytes };
  });

  const missingFiles = requiredFiles
    .filter((file) => !file.exists || file.sizeBytes === 0)
    .map((file) => file.name);

  return {
    installed: missingFiles.length === 0,
    modelDir,
    requiredFiles,
    missingFiles
  };
}

export async function downloadSenseVoiceOnnxModel(modelDir: string): Promise<LocalModelDownloadResult> {
  mkdirSync(modelDir, { recursive: true });

  for (const file of SENSEVOICE_ONNX_FILES) {
    const targetPath = join(modelDir, file.targetName);
    const tempPath = `${targetPath}.download`;
    rmSync(tempPath, { force: true });
    await downloadToFile(file.url, tempPath);

    const sizeBytes = statSync(tempPath).size;
    if (sizeBytes < file.minBytes) {
      rmSync(tempPath, { force: true });
      throw new Error(`Downloaded file is too small: ${file.targetName}`);
    }
    renameSync(tempPath, targetPath);
  }

  return {
    ...getLocalModelStatus(modelDir),
    ok: true,
    message: '模型下载完成'
  };
}

export async function openLocalModelDir(modelDir: string): Promise<void> {
  mkdirSync(modelDir, { recursive: true });
  await shell.openPath(modelDir);
}

function downloadToFile(url: string, targetPath: string, redirectCount = 0): Promise<void> {
  if (redirectCount > 5) {
    return Promise.reject(new Error(`Too many redirects while downloading ${url}`));
  }

  mkdirSync(dirname(targetPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      const statusCode = response.statusCode ?? 0;
      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        const redirected = new URL(response.headers.location, url).toString();
        downloadToFile(redirected, targetPath, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${statusCode}: ${url}`));
        return;
      }

      const output = createWriteStream(targetPath);
      response.pipe(output);
      output.on('finish', () => {
        output.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      output.on('error', (error) => {
        rmSync(targetPath, { force: true });
        reject(error);
      });
    });

    request.setTimeout(60_000, () => {
      request.destroy(new Error(`Download timed out: ${url}`));
    });
    request.on('error', (error) => {
      rmSync(targetPath, { force: true });
      reject(error);
    });
  });
}

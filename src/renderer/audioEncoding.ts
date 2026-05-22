export async function encodeBlobToWav(blob: Blob): Promise<ArrayBuffer> {
  const audioData = await blobToArrayBuffer(blob);
  const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    return audioData;
  }

  const context = new AudioContextCtor();
  try {
    const audioBuffer = await context.decodeAudioData(audioData.slice(0));
    return encodeAudioBufferToWav(audioBuffer);
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('无法读取录音数据'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error('录音数据格式无法读取'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

export function encodeAudioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const sampleCount = audioBuffer.length;
  const bytesPerSample = 2;
  const dataSize = sampleCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData = Array.from({ length: channelCount }, (_, index) => audioBuffer.getChannelData(index));
  let offset = 44;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const value = Math.max(-1, Math.min(1, channelData[channel][sample] ?? 0));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return buffer;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

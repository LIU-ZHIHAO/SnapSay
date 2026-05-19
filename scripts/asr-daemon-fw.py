import sys
import os
import io
import json
import struct
import socket
import threading

import numpy as np
import av

os.environ.setdefault('HF_HOME', r'D:\Antigravity\tailkall\cache\huggingface')
os.environ.setdefault('HUGGINGFACE_HUB_CACHE', r'D:\Antigravity\tailkall\cache\huggingface\hub')

from faster_whisper import WhisperModel

_model_path = os.environ.get('ASR_MODEL_PATH', r'models/faster-whisper/small')
_device_str = os.environ.get('ASR_DEVICE', 'cuda')
_device = 'cuda' if _device_str not in ('cpu',) else 'cpu'
_compute_type = 'float16' if _device == 'cuda' else 'int8'

try:
    model = WhisperModel(_model_path, device=_device, compute_type=_compute_type, local_files_only=True)
except Exception:
    model = WhisperModel(_model_path, device='cpu', compute_type='int8', local_files_only=True)

# GPU kernel warmup
_dummy = np.zeros(16000, dtype=np.float32)
list(model.transcribe(_dummy, language='zh', vad_filter=True)[0])


def decode_audio_16k(raw: bytes) -> np.ndarray:
    container = av.open(io.BytesIO(raw))
    stream = container.streams.audio[0]
    resampler = av.AudioResampler(format='fltp', layout='mono', rate=16000)
    frames = []
    for frame in container.decode(stream):
        for rf in resampler.resample(frame):
            frames.append(rf.to_ndarray()[0])
    for rf in resampler.resample(None):
        frames.append(rf.to_ndarray()[0])
    container.close()
    return np.concatenate(frames).astype(np.float32)


def handle(conn: socket.socket) -> None:
    try:
        while True:
            header = b''
            while len(header) < 4:
                chunk = conn.recv(4 - len(header))
                if not chunk:
                    return
                header += chunk
            size = struct.unpack('>I', header)[0]
            data = b''
            while len(data) < size:
                chunk = conn.recv(min(65536, size - len(data)))
                if not chunk:
                    return
                data += chunk
            audio = decode_audio_16k(data)
            segs, _ = model.transcribe(audio, language='zh', vad_filter=True)
            text = ''.join(s.text for s in segs).strip()
            resp = json.dumps({'text': text}) + '\n'
            conn.sendall(resp.encode('utf-8'))
    except Exception as exc:
        try:
            conn.sendall((json.dumps({'error': str(exc)}) + '\n').encode('utf-8'))
        except Exception:
            pass
    finally:
        conn.close()


srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(('127.0.0.1', 0))
srv.listen(5)
port = srv.getsockname()[1]

port_file = os.environ.get(
    'ASR_PORT_FILE',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'asr-daemon-fw.port')
)
os.makedirs(os.path.dirname(port_file), exist_ok=True)
with open(port_file, 'w') as f:
    f.write(str(port))

while True:
    conn, _ = srv.accept()
    threading.Thread(target=handle, args=(conn,), daemon=True).start()

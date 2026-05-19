import sys
import os
import io
import re
import json
import struct
import socket
import threading

import numpy as np
import av

os.environ.setdefault('MODELSCOPE_CACHE', r'D:\Antigravity\tailkall\cache\modelscope')
os.environ.setdefault('HF_HOME', r'D:\Antigravity\tailkall\cache\huggingface')

from funasr import AutoModel

_model_path = os.environ.get('ASR_MODEL_PATH', r'models/sensevoice/SenseVoiceSmall')
_device = os.environ.get('ASR_DEVICE', 'cuda:0')

try:
    model = AutoModel(model=_model_path, trust_remote_code=True, device=_device, disable_update=True)
except Exception:
    model = AutoModel(model=_model_path, trust_remote_code=True, device='cpu', disable_update=True)

# GPU kernel warmup — makes first real inference fast
_dummy = np.zeros(16000, dtype=np.float32)
model.generate(input=_dummy, input_len=[len(_dummy)], language='zh', use_itn=True)


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


def clean_text(value: str) -> str:
    value = re.sub(r'<\|[^|]+\|>', '', value)
    if any(m in value for m in ('å', 'ä', 'ç', 'è', 'é')):
        try:
            value = value.encode('latin1').decode('utf-8')
        except UnicodeError:
            pass
    return value


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
            result = model.generate(input=audio, input_len=[len(audio)], language='zh', use_itn=True)
            text = ''
            for item in (result if isinstance(result, list) else [result]):
                if isinstance(item, dict) and item.get('text'):
                    text += clean_text(str(item['text']))
            resp = json.dumps({'text': text.strip()}) + '\n'
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
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'asr-daemon.port')
)
os.makedirs(os.path.dirname(port_file), exist_ok=True)
with open(port_file, 'w') as f:
    f.write(str(port))

while True:
    conn, _ = srv.accept()
    threading.Thread(target=handle, args=(conn,), daemon=True).start()

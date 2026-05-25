"""ASR daemon using ONNX Runtime (no PyTorch dependency)."""
import sys
import os
import json
import struct
import socket
import threading
from pathlib import Path

import numpy as np

# When packaged by PyInstaller, sys.executable points to the EXE location
if getattr(sys, 'frozen', False):
    PROJECT_ROOT = Path(sys.executable).resolve().parent
else:
    PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = os.environ.get("ASR_MODEL_PATH", str(PROJECT_ROOT / "models" / "sensevoice" / "SenseVoiceSmall"))
PORT_FILE = os.environ.get("ASR_PORT_FILE", str(PROJECT_ROOT / "data" / "asr-daemon.port"))

# ── Audio helpers ──────────────────────────────────────────────────

def load_audio(path: str, target_sr: int = 16000) -> np.ndarray:
    """Load audio file and return mono float32 samples at target_sr."""
    import av
    container = av.open(path)
    stream = container.streams.audio[0]
    resampler = av.audio.resampler.AudioResampler(
        format="s16", layout="mono", rate=target_sr
    )
    chunks = []
    for frame in container.decode(audio=0):
        resampled = resampler.resample(frame)
        chunks.extend(resampled)
    # Flush
    chunks.extend(resampler.resample(None))
    container.close()
    samples = b"".join(frame.planes[0] for frame in chunks)
    return np.frombuffer(samples, dtype=np.int16).astype(np.float32) / 32768.0

# ── Feature extraction ─────────────────────────────────────────────

def hz_to_mel(hz: float) -> float:
    return 2595.0 * np.log10(1.0 + hz / 700.0)

def mel_to_hz(mel: float) -> float:
    return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)

def compute_mel_filterbank(n_mels: int, n_fft: int, sr: int) -> np.ndarray:
    low_mel = hz_to_mel(0)
    high_mel = hz_to_mel(sr / 2)
    mel_points = np.linspace(low_mel, high_mel, n_mels + 2)
    hz_points = mel_to_hz(mel_points)
    bin_points = np.round(hz_points / (sr / n_fft)).astype(int)
    filters = np.zeros((n_mels, n_fft // 2 + 1))
    for m in range(n_mels):
        left = bin_points[m]
        center = bin_points[m + 1]
        right = bin_points[m + 2]
        for k in range(left, center):
            if center != left:
                filters[m, k] = (k - left) / (center - left)
        for k in range(center, right):
            if right != center:
                filters[m, k] = (right - k) / (right - center)
    return filters

def extract_fbank(audio: np.ndarray, sr: int = 16000, n_mels: int = 80,
                  frame_length: float = 0.025, frame_shift: float = 0.01) -> np.ndarray:
    """Extract mel filterbank features."""
    n_fft = int(sr * frame_length)
    hop_length = int(sr * frame_shift)
    win_length = n_fft

    # Pad audio
    pad_len = n_fft - len(audio) % hop_length
    audio = np.pad(audio, (0, pad_len))

    # Framing
    n_frames = 1 + (len(audio) - n_fft) // hop_length
    indices = np.arange(n_fft)[None, :] + np.arange(n_frames)[:, None] * hop_length
    frames = audio[indices]

    # Window + FFT
    window = np.hamming(n_fft)
    frames = frames * window
    fft_result = np.fft.rfft(frames, n=n_fft)
    power_spectrum = (np.abs(fft_result) ** 2) / n_fft

    # Mel filterbank
    mel_filters = compute_mel_filterbank(n_mels, n_fft, sr)
    mel_energies = power_spectrum @ mel_filters.T
    log_mel = np.log(np.maximum(mel_energies, 1e-10))
    return log_mel.astype(np.float32)

def apply_lfr(feat: np.ndarray, lfr_m: int = 7, lfr_n: int = 6) -> np.ndarray:
    """Low Frame Rate: merge lfr_m frames with step lfr_n."""
    n_frames = feat.shape[0]
    feat_dim = feat.shape[1]
    out_frames = (n_frames - lfr_m) // lfr_n + 1
    lfr_feat = np.zeros((out_frames, feat_dim * lfr_m), dtype=np.float32)
    for i in range(out_frames):
        start = i * lfr_n
        lfr_feat[i] = feat[start:start + lfr_m].reshape(-1)
    return lfr_feat

# ── CMVN ───────────────────────────────────────────────────────────

def parse_cmvn(path: str):
    """Parse Kaldi-style CMVN file → (shift, scale) arrays of dim 560."""
    shift = None
    scale = None
    mode = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("<AddShift>"):
                mode = "shift"
                continue
            if line.startswith("<Rescale>"):
                mode = "scale"
                continue
            # Extract values from lines like "<LearnRateCoef> 0 [ -8.31 ... ]"
            bracket_start = line.find("[")
            bracket_end = line.rfind("]")
            if bracket_start >= 0 and bracket_end > bracket_start:
                vals = np.array([float(x) for x in line[bracket_start+1:bracket_end].split()], dtype=np.float32)
                if mode == "shift":
                    shift = vals
                elif mode == "scale":
                    scale = vals
    return shift, scale

# ── ONNX inference ─────────────────────────────────────────────────

class SenseVoiceONNX:
    def __init__(self, model_dir: str):
        import onnxruntime as ort
        onnx_path = os.path.join(model_dir, "model.onnx")
        self.session = ort.InferenceSession(onnx_path)
        self.tokens = self._load_tokens(model_dir)
        shift, scale = parse_cmvn(os.path.join(model_dir, "am.mvn"))
        self.cmvn_shift = shift
        self.cmvn_scale = scale
        # Embedding indices (from SenseVoice config)
        self.lid_dict = {"zh": 3, "en": 4, "ja": 5, "ko": 6, "yue": 7}
        self.textnorm_dict = {"withitn": 12, "woitn": 13}

    def _load_tokens(self, model_dir: str) -> list:
        with open(os.path.join(model_dir, "tokens.json"), encoding="utf-8") as f:
            return json.load(f)

    def _make_embedding(self, idx: int) -> np.ndarray:
        """Create a 1x1 embedding vector by using the token id as a simple lookup."""
        # SenseVoice uses a learned embedding layer; for ONNX we pre-compute
        # the embedding weights from the model and do a lookup.
        # Since the ONNX model doesn't include the embedding, we handle it in preprocessing.
        return np.array([[idx]], dtype=np.int64)

    def transcribe(self, audio_path: str, language: str = "zh", use_itn: bool = True) -> str:
        # 1. Load audio
        audio = load_audio(audio_path, target_sr=16000)

        # 2. Extract fbank
        feat = extract_fbank(audio, sr=16000, n_mels=80)

        # 3. LFR
        lfr_feat = apply_lfr(feat, lfr_m=7, lfr_n=6)

        # 4. CMVN: output = (input + shift) * scale
        lfr_feat = (lfr_feat + self.cmvn_shift) * self.cmvn_scale

        # 5. Prepare inputs for ONNX model
        speech = lfr_feat[np.newaxis, :, :]  # (1, T, 560)
        speech_lengths = np.array([speech.shape[1]], dtype=np.int32)

        lang_id = self.lid_dict.get(language, 0)
        language = np.array([lang_id], dtype=np.int32)

        textnorm_mode = "withitn" if use_itn else "woitn"
        textnorm_id = self.textnorm_dict.get(textnorm_mode, 0)
        textnorm = np.array([textnorm_id], dtype=np.int32)

        # 6. Run ONNX inference
        ctc_logits, encoder_out_lens = self.session.run(None, {
            "speech": speech,
            "speech_lengths": speech_lengths,
            "language": language,
            "textnorm": textnorm,
        })

        # 7. CTC greedy decode
        logits = ctc_logits[0]  # (T, vocab)
        tokens = np.argmax(logits, axis=-1)

        # Deduplicate consecutive tokens and remove blank (0)
        prev = -1
        result_ids = []
        for t in tokens:
            if t != prev and t != 0:
                result_ids.append(int(t))
            prev = t

        # Convert token ids to text
        text = "".join(self.tokens[i] for i in result_ids if i < len(self.tokens))
        # Clean up SentencePiece markers
        text = text.replace("▁", " ").strip()
        # Strip metadata tags like <|zh|><|NEUTRAL|><|Speech|><|woitn|>
        import re
        text = re.sub(r"<\|[^|]+\|>", "", text).strip()
        return text

# ── Socket server ──────────────────────────────────────────────────

def handle_client(conn: socket.socket, model: SenseVoiceONNX):
    try:
        # Read 4-byte big-endian length header
        header = b""
        while len(header) < 4:
            chunk = conn.recv(4 - len(header))
            if not chunk:
                return
            header += chunk
        length = struct.unpack(">I", header)[0]

        # Read audio data
        audio_data = b""
        while len(audio_data) < length:
            chunk = conn.recv(min(length - len(audio_data), 65536))
            if not chunk:
                return
            audio_data += chunk

        # Write audio to temp file
        import tempfile
        tmp = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
        tmp.write(audio_data)
        tmp.close()

        try:
            text = model.transcribe(tmp.name, language="zh", use_itn=True)
        finally:
            os.unlink(tmp.name)

        # Send result as JSON + newline
        response = json.dumps({"text": text}) + "\n"
        conn.sendall(response.encode("utf-8"))
    except Exception as e:
        error_resp = json.dumps({"error": str(e)}) + "\n"
        try:
            conn.sendall(error_resp.encode("utf-8"))
        except Exception:
            pass
    finally:
        conn.close()

def main():
    print(f"[ASR-ONNX] Loading model from {MODEL_DIR} ...", flush=True)
    model = SenseVoiceONNX(MODEL_DIR)
    print(f"[ASR-ONNX] Model loaded. Tokens: {len(model.tokens)}", flush=True)

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 0))
    port = server.getsockname()[1]
    server.listen(5)

    # Write port file
    Path(PORT_FILE).write_text(str(port))
    print(f"[ASR-ONNX] Listening on port {port}", flush=True)

    try:
        while True:
            conn, addr = server.accept()
            t = threading.Thread(target=handle_client, args=(conn, model), daemon=True)
            t.start()
    except KeyboardInterrupt:
        pass
    finally:
        server.close()
        try:
            os.unlink(PORT_FILE)
        except Exception:
            pass

if __name__ == "__main__":
    main()

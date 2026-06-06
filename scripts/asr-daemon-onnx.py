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
TMP_DIR = Path(os.environ.get("ASR_TMP_DIR", str(PROJECT_ROOT / "tmp")))
PREFERRED_PROVIDER = os.environ.get("ASR_ONNX_PROVIDER", "auto").lower()
LOCK_FILE = os.environ.get("ASR_LOCK_FILE", str(PROJECT_ROOT / "data" / "asr-daemon.lock"))
LOCK_HANDLE = None

def acquire_daemon_lock() -> bool:
    """Keep one ASR daemon per runtime root, even during repeated app launches."""
    global LOCK_HANDLE
    lock_path = Path(LOCK_FILE)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    LOCK_HANDLE = open(lock_path, "a+b")
    try:
        if os.name == "nt":
            import msvcrt
            LOCK_HANDLE.seek(0)
            msvcrt.locking(LOCK_HANDLE.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(LOCK_HANDLE.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return False

    LOCK_HANDLE.seek(0)
    LOCK_HANDLE.truncate()
    LOCK_HANDLE.write(str(os.getpid()).encode("utf-8"))
    LOCK_HANDLE.flush()
    return True

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

def extract_fbank(audio: np.ndarray, sr: int = 16000, n_mels: int = 80,
                  frame_length: float = 0.025, frame_shift: float = 0.01) -> np.ndarray:
    """Extract Kaldi-compatible fbank features expected by SenseVoice ONNX."""
    import kaldi_native_fbank as knf
    opts = knf.FbankOptions()
    opts.frame_opts.samp_freq = sr
    opts.frame_opts.dither = 0
    opts.frame_opts.window_type = "hamming"
    opts.frame_opts.frame_shift_ms = frame_shift * 1000
    opts.frame_opts.frame_length_ms = frame_length * 1000
    opts.frame_opts.snip_edges = True
    opts.mel_opts.num_bins = n_mels
    opts.energy_floor = 0
    opts.mel_opts.debug_mel = False

    fbank = knf.OnlineFbank(opts)
    fbank.accept_waveform(sr, (audio * (1 << 15)).tolist())
    frames = fbank.num_frames_ready
    feat = np.empty([frames, n_mels], dtype=np.float32)
    for i in range(frames):
        feat[i, :] = fbank.get_frame(i)
    return feat

def apply_lfr(feat: np.ndarray, lfr_m: int = 7, lfr_n: int = 6) -> np.ndarray:
    """Low Frame Rate: merge lfr_m frames with step lfr_n."""
    n_frames = feat.shape[0]
    if n_frames == 0:
        return np.zeros((0, feat.shape[1] * lfr_m), dtype=np.float32)

    left_padding = np.tile(feat[0], ((lfr_m - 1) // 2, 1))
    feat = np.vstack((left_padding, feat))
    padded_frames = n_frames + (lfr_m - 1) // 2
    out_frames = int(np.ceil(n_frames / lfr_n))
    lfr_feat = []
    for i in range(out_frames):
        start = i * lfr_n
        if lfr_m <= padded_frames - start:
            lfr_feat.append(feat[start:start + lfr_m].reshape(1, -1))
        else:
            frame = feat[start:].reshape(-1)
            pad_count = lfr_m - (padded_frames - start)
            for _ in range(pad_count):
                frame = np.hstack((frame, feat[-1]))
            lfr_feat.append(frame.reshape(1, -1))
    return np.vstack(lfr_feat).astype(np.float32)

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
        self.ort = ort
        self.onnx_path = onnx_path
        self.cpu_session = None
        self.session = self._create_session(ort, onnx_path)
        self.execution_providers = self.session.get_providers()
        self.tokens = self._load_tokens(model_dir)
        shift, scale = parse_cmvn(os.path.join(model_dir, "am.mvn"))
        self.cmvn_shift = shift
        self.cmvn_scale = scale
        # Embedding indices (from SenseVoice config)
        self.lid_dict = {"zh": 3, "en": 4, "ja": 5, "ko": 6, "yue": 7}
        self.textnorm_dict = {"withitn": 14, "woitn": 15}

    def _create_session(self, ort, onnx_path: str):
        available = set(ort.get_available_providers())
        provider_candidates = []
        if PREFERRED_PROVIDER in ("auto", "gpu", "directml", "dml"):
            if "DmlExecutionProvider" in available:
                provider_candidates.append(["DmlExecutionProvider", "CPUExecutionProvider"])
        if PREFERRED_PROVIDER in ("cpu",):
            provider_candidates.append(["CPUExecutionProvider"])
        elif not provider_candidates:
            provider_candidates.append(["CPUExecutionProvider"])

        errors = []
        for providers in provider_candidates:
            try:
                return ort.InferenceSession(onnx_path, providers=providers)
            except Exception as exc:
                errors.append(f"{providers}: {exc}")

        if PREFERRED_PROVIDER != "cpu":
            try:
                return ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
            except Exception as exc:
                errors.append(f"['CPUExecutionProvider']: {exc}")

        raise RuntimeError("Unable to create ONNX Runtime session: " + " | ".join(errors))

    def _get_cpu_session(self):
        if self.cpu_session is None:
            print("[ASR-ONNX] Creating CPU fallback session after runtime failure.", flush=True)
            self.cpu_session = self.ort.InferenceSession(self.onnx_path, providers=["CPUExecutionProvider"])
        return self.cpu_session

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
        inputs = {
            "speech": speech,
            "speech_lengths": speech_lengths,
            "language": language,
            "textnorm": textnorm,
        }
        try:
            ctc_logits, encoder_out_lens = self.session.run(None, inputs)
        except Exception as exc:
            if "DmlExecutionProvider" not in self.execution_providers:
                raise
            print(f"[ASR-ONNX] DirectML inference failed, retrying CPU: {exc}", flush=True)
            ctc_logits, encoder_out_lens = self._get_cpu_session().run(None, inputs)

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
        TMP_DIR.mkdir(parents=True, exist_ok=True)
        tmp = tempfile.NamedTemporaryFile(suffix=".webm", delete=False, dir=str(TMP_DIR))
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
    if not acquire_daemon_lock():
        print(f"[ASR-ONNX] Another daemon already holds lock: {LOCK_FILE}", flush=True)
        return

    print(f"[ASR-ONNX] Loading model from {MODEL_DIR} ...", flush=True)
    model = SenseVoiceONNX(MODEL_DIR)
    print(f"[ASR-ONNX] Model loaded. Tokens: {len(model.tokens)}", flush=True)
    print(f"[ASR-ONNX] Execution providers: {', '.join(model.execution_providers)}", flush=True)

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

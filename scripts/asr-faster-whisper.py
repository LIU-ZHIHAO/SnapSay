import argparse
import os


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--prompt", default="")
    args = parser.parse_args()

    os.environ.setdefault("HF_HOME", r"D:\Antigravity\tailkall\cache\huggingface")
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", r"D:\Antigravity\tailkall\cache\huggingface\hub")

    from faster_whisper import WhisperModel

    device = "cuda" if args.device == "auto" else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    try:
        model = WhisperModel(args.model, device=device, compute_type=compute_type, local_files_only=True)
    except Exception:
        if args.device != "auto":
            raise
        model = WhisperModel(args.model, device="cpu", compute_type="int8", local_files_only=True)

    segments, _info = model.transcribe(args.audio, language=args.language, vad_filter=True, initial_prompt=args.prompt or None)
    text = "".join(segment.text for segment in segments).strip()
    with open(args.out, "w", encoding="utf-8") as file:
        file.write(text)


if __name__ == "__main__":
    main()

import argparse
import os
import re
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--language", default="zh")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[1]
    os.environ.setdefault("MODELSCOPE_CACHE", str(project_root / "cache" / "modelscope"))
    os.environ.setdefault("HF_HOME", str(project_root / "cache" / "huggingface"))

    from funasr import AutoModel

    device = "cuda:0" if args.device == "auto" else "cpu"
    try:
      model = AutoModel(model=args.model, trust_remote_code=True, device=device, disable_update=True)
    except Exception:
      if args.device != "auto":
        raise
      model = AutoModel(model=args.model, trust_remote_code=True, device="cpu", disable_update=True)

    result = model.generate(input=args.audio, language=args.language, use_itn=True)
    text_parts = []
    for item in result if isinstance(result, list) else [result]:
        if isinstance(item, dict) and item.get("text"):
            text_parts.append(clean_text(str(item["text"])))
    with open(args.out, "w", encoding="utf-8") as file:
        file.write("".join(text_parts).strip())


def clean_text(value: str) -> str:
    value = re.sub(r"<\|[^|]+\|>", "", value)
    if any(marker in value for marker in ("å", "ä", "ç", "è", "é")):
        try:
            value = value.encode("latin1").decode("utf-8")
        except UnicodeError:
            pass
    return value


if __name__ == "__main__":
    main()

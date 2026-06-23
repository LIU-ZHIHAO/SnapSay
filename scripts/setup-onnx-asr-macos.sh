#!/usr/bin/env bash
set -euo pipefail

ROOT="${SNAPSAY_ROOT:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"}"
VENV="$ROOT/.venv"
PYTHON="$VENV/bin/python"
CACHE="$ROOT/cache"

mkdir -p "$CACHE"
export PIP_CACHE_DIR="$CACHE/pip"
export HF_HOME="$CACHE/huggingface"
export HUGGINGFACE_HUB_CACHE="$CACHE/huggingface/hub"
export MODELSCOPE_CACHE="$CACHE/modelscope"
export TORCH_HOME="$CACHE/torch"
export XDG_CACHE_HOME="$CACHE"
export SNAPSAY_ROOT="$ROOT"

if [ ! -x "$PYTHON" ]; then
  python3 -m venv "$VENV"
fi

"$PYTHON" -m pip install --retries 5 --timeout 120 -i "${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}" --upgrade numpy av kaldi-native-fbank onnxruntime
"$PYTHON" -c "import onnxruntime as ort; print('onnxruntime providers: ' + ', '.join(ort.get_available_providers()))"

echo "python: $PYTHON"

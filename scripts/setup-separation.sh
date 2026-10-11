#!/usr/bin/env bash
# Installs the neural stem separator (Demucs) into ./tools — nothing outside this folder is touched.
# Needs `uv` (https://docs.astral.sh/uv/). ~1 GB download, one time. Intel Macs: PyTorch 2.2.2 is the last build for x86 macOS.
set -euo pipefail
cd "$(dirname "$0")/.."
export UV_CACHE_DIR="$PWD/tools/.uv-cache" UV_PYTHON_INSTALL_DIR="$PWD/tools/python" TORCH_HOME="$PWD/tools/torch"
uv venv tools/venv --python 3.11
uv pip install --python tools/venv/bin/python "torch==2.2.2" "torchaudio==2.2.2" "numpy<2" demucs soundfile
tools/venv/bin/python - <<'PY'
import torch, demucs; print("demucs", demucs.__version__, "torch", torch.__version__)
from demucs.pretrained import get_model
get_model("htdemucs"); print("model ready")
PY

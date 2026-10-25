#!/usr/bin/env bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" || exit 0
script="$script_dir/native_batch_nudge.py"
[[ -f "$script" ]] || exit 0
python3 "$script"
exit 0

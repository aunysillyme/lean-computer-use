#!/usr/bin/env bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" || exit 0
script="$script_dir/stop_gate.py"
[[ -f "$script" ]] || exit 0
python3 "$script" 2>/dev/null
exit 0

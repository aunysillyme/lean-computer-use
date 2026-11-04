#!/usr/bin/env bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" || exit 0
script="$script_dir/touch_hook.py"
[[ -f "$script" ]] || exit 0
python3 "$script" >/dev/null 2>&1
exit 0

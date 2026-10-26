#!/usr/bin/env bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" || exit 0
script="$script_dir/cleanup_hook.py"
[[ -f "$script" ]] || exit 0
python3 "$script" >/dev/null
exit 0

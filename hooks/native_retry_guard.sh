#!/usr/bin/env bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" || exit 0
script="$script_dir/native_retry_guard.py"
[[ -f "$script" ]] || exit 0
python3 "$script"
result=$?
[[ "$result" -eq 2 ]] && exit 2
exit 0

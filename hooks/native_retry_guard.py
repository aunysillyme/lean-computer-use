#!/usr/bin/env python3
"""Stop a third identical native-app attempt after two error results."""
import json
import sys

from _common import failed, fingerprint, native_call, session_state


def main():
    try:
        payload = json.load(sys.stdin)
        call = native_call(payload)
        event = payload.get("hook_event_name")
        if call is None or call["probe"] or event not in {"PreToolUse", "PostToolUse"}:
            return 0
        key = fingerprint(payload)
        with session_state(payload) as state:
            previous = state.get("retry", {})
            if event == "PreToolUse":
                if previous.get("fingerprint") == key and previous.get("count", 0) >= 2:
                    print("Stop and report the repeated native-app error. Try a different approach before calling again.",
                          file=sys.stderr)
                    return 2
            elif failed(payload):
                count = previous.get("count", 0) + 1 if previous.get("fingerprint") == key else 1
                state["retry"] = {"fingerprint": key, "count": count, "target": call["target"]}
            elif (previous.get("fingerprint") == key
                  or call["target"] is not None and call["target"] != previous.get("target")):
                state.pop("retry", None)
        return 0
    except Exception:
        return 0


if __name__ == "__main__":
    sys.exit(main())

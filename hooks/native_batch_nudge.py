#!/usr/bin/env python3
"""Suggest one chained call after consecutive single native-app actions."""
import json
import sys

from _common import native_call, session_state

MESSAGE = ("Consecutive single native-app actions each re-read the conversation. "
           "Chain the remaining actions into ONE call: desk <bundle> <tool> '<json>' && ... "
           "Then read once with a filtered desk-read.")


def main():
    try:
        payload = json.load(sys.stdin)
        if payload.get("hook_event_name") != "PostToolUse":
            return 0
        call = native_call(payload)
        if call is None:
            return 0
        with session_state(payload) as state:
            if call["probe"] or call["read"] or call["batch"]:
                state.pop("batch", None)
                return 0
            streak = state.setdefault("batch", {"count": 0, "nudged": False})
            streak["count"] += 1
            if streak["count"] >= 2 and not streak["nudged"]:
                streak["nudged"] = True
                print(json.dumps({"hookSpecificOutput": {
                    "hookEventName": "PostToolUse", "additionalContext": MESSAGE}}))
        return 0
    except Exception:
        return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""End this session's leased processes on SubagentStop, Stop and SessionEnd. Never blocks."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "desk"))

if __name__ == "__main__":
    try:
        import _lease
        _lease.hook_main()
    except Exception:
        pass
    sys.exit(0)

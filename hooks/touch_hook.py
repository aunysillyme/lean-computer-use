#!/usr/bin/env python3
"""Record native desktop actions and successful releases per session and subagent. Never blocks."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

if __name__ == "__main__":
    try:
        import _surfaces
        _surfaces.hook("touch")
    except Exception:
        pass
    sys.exit(0)

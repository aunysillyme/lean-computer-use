#!/usr/bin/env python3
"""Block a Stop or runner SubagentStop once while desktop control is still held."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

if __name__ == "__main__":
    try:
        import _surfaces
        _surfaces.hook("gate")
    except Exception:
        pass
    sys.exit(0)

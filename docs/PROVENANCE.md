# Provenance

This package implements a native app workflow: frame the job in the main session, run app actions in a smaller context, then verify saved evidence.
The desk wrappers build on cua-driver from [trycua/cua](https://github.com/trycua/cua).
The driver is a separate installation; its code and app are not bundled.

| Technique | Source | Local implementation |
|---|---|---|
| Background app actions through the accessibility tree | [trycua/cua](https://github.com/trycua/cua) | `desk/desk`, `desk/_resolve.py` |
| Small-context runner and hook lifecycle | [Claude Code](https://code.claude.com/docs/en/overview) | `agents/desk-runner.md`, `hooks/`, `src/hooks-register.mjs` |
| Packet actions and index choice from observed candidates | [Jev / typesafe-sdk](https://pypi.org/project/typesafe-sdk/) | `skills/lean-computer-use/methods/desk-run.md`, `same-app-chaining.md` |
| Filtered output with retained full evidence | [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | `desk/desk-read`, `skills/lean-computer-use/methods/filtered-reads.md` |
| Plain retrieval before interactive browsing | [Crawl4AI](https://github.com/unclecode/crawl4ai), [SearXNG](https://github.com/searxng/searxng) | Context only; native app tasks stay in `docs/METHOD.md` |
| The same method applied to web pages | [lean-browser-use](https://github.com/aunysillyme/lean-browser-use) | `docs/METHOD.md`, README sibling link |

The public runner and native hooks are written for this package.
Example transcripts are synthetic.
Measurements describe this package or its fixture, with commands and dates in `proof/results.json`.
Upstream licence versions were not rechecked over the network during this build: see the linked repositories and [CREDITS.md](../CREDITS.md).

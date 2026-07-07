# Phase 1 Spike — one section reproduces 真·C (PASS)

Main-session real-machine spike (2026-07-08). Drove the running `pi_runtime`
sidecar over a shared workspace, one section (`tech-understanding`), through the
real product wiring (build prompt via `build_c_prompt` + mounted vendor skill +
resolved mimo creds → `POST /internal/pi/draft-section` → pi → shared workspace
→ read back). Gate for Phase 2.

## Result (after the two spike-found fixes)

| check | 真·C ref | this spike | pass |
|-------|----------|-----------|------|
| status | agent | agent (no fallback, no timeout) | ✅ |
| wall-clock | ~80–210s | 57s (< 420) | ✅ |
| non-space chars | 4.4k–9.2k | 6680 | ✅ |
| tool executions | tens | 16 (read7/ls7/find1/write1) | ✅ |
| skeleton-first write | yes | write present | ✅ |
| must_keep 「科改政策」 | 1–3 | 2 | ✅ |
| B-signature fabrication (600家/转化率10%) | 0 | 0 | ✅ |

sidecar response: `{"status":"agent","section_chars":6993,"tool_calls":{"read":7,"grep":0,"find":1,"ls":7,"write":1,"edit":0,"total":16}}`

## Two bugs the spike caught (both in the Phase-1 code, fixed in commit f0ac1668)

1. **pi hangs on open stdin → 420s timeout / 0 tool calls.** Node `spawn`'s
   default `stdio:'pipe'` hands pi an open, never-closed stdin; pi blocks before
   the agent loop and emits nothing until the timeout kills it. Fix: spawn with
   `stdio:['ignore','pipe','pipe']`. Locked by a regression test (fake-pi
   `waitstdin` mode).
2. **`section_chars` always 0.** Handler read `<ws>/sections/<id>.md`, but the
   drafting prompt writes to `workspace/sections/<id>.md` (the validated
   bake-off / BidWorkspace layout). Fix: read `<ws>/workspace/sections/<id>.md`.

## Conclusion

The "port PI into an internal node sidecar over a shared workspace volume"
architecture is validated in-product: it reproduces 真·C's quality + reliability
signature. **Phase 2 (backend integration) is unblocked.**

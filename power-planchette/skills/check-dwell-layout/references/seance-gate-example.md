<!-- Copy of docs/seance-gate.md in https://github.com/4KInc/planchette-kit, taken on 28 Nov 2026, as a worked example of the dwell gate. Everything after the line "=== copy starts ===" is verbatim. Links in the copy that start with ../ point to files in that repository. -->
=== copy starts ===
# Séance gate: the default dwell time
27 Nov 2026. Séance's default dwell time is 2100 ms, the Board's default. This file records whether the Séance layout passes the same gate at that dwell time.
The simulator models head pointing with published group averages, not real people. It does not model every user or every habit. See [tools/dwell-sim-mcp/METHODOLOGY.md](../tools/dwell-sim-mcp/METHODOLOGY.md).
All numbers are accidental selections per 100 intended selections, from `dwell-sim-mcp`, preset `reads-while-pointing`, task `{ eachTarget: 2 }`, 30 fps, 10 trials, dwell time 2100 ms, on Séance's four layouts (the playing view and the Summary, at 1920x1080 and 1366x768).
## The gate rule
`reads-while-pointing` makes at most 10 accidental selections per 100 intended on every layout, for the worst of seeds 1 to 10. This is the rule the Board's default was chosen by. If it is missed, the work stops and the numbers are reported; the default dwell time, the layout and the limit are not changed without the user's approval.
## Seeds
| Seed | play-1920x1080 | play-1366x768 | summary-1920x1080 | summary-1366x768 |
| --- | --- | --- | --- | --- |
| 1 | 3.8 | 4.1 | 0 | 0 |
| 2 | 1.5 | 0.8 | 0 | 0 |
| 3 | 4.5 | 5.2 | 0.7 | 0 |
| 4 | 2.3 | 1.8 | 0 | 0 |
| 5 | 2.6 | 2.4 | 0 | 0 |
| 6 | 2.6 | 3.7 | 0 | 0 |
| 7 | 4.3 | 3.7 | 0 | 0 |
| 8 | 3.5 | 3.2 | 0 | 0 |
| 9 | 7.1 | 3.4 | 0.8 | 0 |
| 10 | 4 | 2.6 | 0.7 | 0 |
| **Worst** | **7.1** (seed 9) | **5.2** (seed 3) | **0.8** (seed 9) | **0** (seed 1) |
## Verdict
**Pass.** The worst value is 7.1 (play-1920x1080, seed 9), at or below 10.

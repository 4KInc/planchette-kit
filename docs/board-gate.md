# Board gate: the Board's default dwell time

27 Nov 2026. The Board default dwell time is 2100 ms (user decision, chosen by the multi-seed rule below).

The simulator models head pointing with published group averages, not real people. It does not model every user or every habit. See [tools/dwell-sim-mcp/METHODOLOGY.md](../tools/dwell-sim-mcp/METHODOLOGY.md).

All numbers are accidental selections per 100 intended selections, from `dwell-sim-mcp` with the six presets, task `{ eachTarget: 2 }`, 30 fps, 10 trials, on the Board's four layouts. Column order is core-1920, core-1366, spell-1920, spell-1366.

## The gate rule

The preset reads-while-pointing makes at most 10 accidental selections per 100 intended, on all four layouts.

## The 1400 ms miss

At the old default of 1400 ms, reads-while-pointing made 52.1 / 50.6 / 58.6 / 57.6. The gate failed on all four layouts.

## Why

A reader who stops on a target to read, then moves on slowly, adds the pause and the slow crossing of the next target to the dwell clock. Together they pass the dwell time.

- With no pause, the rate is 0 to 0.5.
- With the pause capped at 600 ms, it is still 39 to 47.

## Seed-1 dwell sweep

| Dwell (ms) | core-1920 | core-1366 | spell-1920 | spell-1366 |
| --- | --- | --- | --- | --- |
| 1000 | 81.2 | 78.2 | 81.6 | 76.8 |
| 1400 | 52.1 | 50.6 | 58.6 | 57.6 |
| 1600 | 33.5 | 32.6 | 41.0 | 39.9 |
| 1800 | 16.7 | 16.4 | 23.4 | 19.4 |
| 1900 | 10.9 | 9.6 | 15.2 | 11.5 |
| 2000 | 5.8 | 4.1 | 9.8 | 6.3 |
| 2200 | 1.7 | 1.2 | 4.1 | 2.3 |

## The multi-seed rule

One seed can pass by luck. The default is the smallest tested dwell time whose worst seed, over seeds 1 to 10, is at most 10 on every layout.

### Seeds 1 to 10

| Dwell (ms) | Layout | Seeds 1 to 10 | Worst | Median | Best |
| --- | --- | --- | --- | --- | --- |
| 2000 | core-1920 | 5.8, 6.6, 10.3, 8.3, 9.7, 7.7, 10.6, 6.1, 10.1, 10.4 | 10.6 | 9.0 | 5.8 |
| 2000 | core-1366 | 4.1, 4.6, 7.8, 6.5, 7.1, 6.6, 8.2, 4.6, 7.4, 7.5 | 8.2 | 6.85 | 4.1 |
| 2000 | spell-1920 | 9.8, 8.4, 8.0, 12.7, 8.9, 10.7, 7.5, 9.6, 9.7, 11.6 | 12.7 | 9.65 | 7.5 |
| 2000 | spell-1366 | 6.3, 8.4, 7.8, 9.5, 6.7, 9.3, 6.3, 5.9, 7.5, 8.0 | 9.5 | 7.65 | 5.9 |
| 2100 | core-1920 | 3.6, 3.5, 6.1, 4.5, 5.8, 3.8, 7.9, 3.8, 6.9, 6.2 | 7.9 | 5.15 | 3.5 |
| 2100 | core-1366 | 2.4, 2.4, 4.2, 3.6, 3.9, 2.8, 4.9, 3.1, 4.5, 4.8 | 4.9 | 3.75 | 2.4 |
| 2100 | spell-1920 | 5.8, 5.7, 5.0, 8.3, 6.0, 5.0, 4.2, 6.5, 5.8, 7.1 | 8.3 | 5.8 | 4.2 |
| 2100 | spell-1366 | 3.8, 4.2, 4.4, 6.1, 3.4, 4.4, 2.3, 3.5, 4.1, 4.3 | 6.1 | 4.15 | 2.3 |
| 2200 | core-1920 | 1.7, 3.3, 4.5, 2.7, 3.7, 2.4, 5.4, 2.5, 5.0, 4.0 | 5.4 | 3.5 | 1.7 |
| 2200 | core-1366 | 1.2, 1.8, 2.7, 2.3, 2.6, 1.5, 4.0, 1.5, 2.9, 3.7 | 4.0 | 2.45 | 1.2 |
| 2200 | spell-1920 | 4.1, 4.9, 2.4, 5.9, 4.3, 2.9, 2.3, 4.0, 4.2, 4.2 | 5.9 | 4.15 | 2.3 |
| 2200 | spell-1366 | 2.3, 3.4, 2.7, 4.3, 2.6, 2.5, 1.6, 2.0, 2.8, 2.8 | 4.3 | 2.65 | 1.6 |

2000 ms fails on the worst seed (10.6 on core-1920, 12.7 on spell-1920). 2100 ms and 2200 ms pass on all four layouts.

## Chosen: 2100 ms

2100 ms is the smallest tested value that passes. Its worst seed is 8.3 (spell-1920). The Board applies it only when no saved Profile exists; a saved dwell time is kept.

## The six presets, seed 1, 1400 ms to 2100 ms

| Preset | core-1920 | core-1366 | spell-1920 | spell-1366 |
| --- | --- | --- | --- | --- |
| steady | 0.5 | 0.4 | 0.4 | 0.4 (unchanged) |
| slow | 0.3 | 0.1 | 0.3 | 0.3 (unchanged) |
| head-tremor | 0.2 | 0.1 | 0.4 | 0.1 (unchanged) |
| strong-head-tremor | 0.1 | 0 | 0.4 → 0.3 | 0.1 |
| small-range | 5.2 | 5.5 | 6.3 | 4.4 (unchanged) |
| reads-while-pointing | 52.1 → 3.6 | 50.6 → 2.4 | 58.6 → 5.8 | 57.6 → 3.8 |

For rows marked unchanged, all four values are the same at 1400 ms and 2100 ms. For strong-head-tremor, only spell-1920 changed.

## Time-to-select cost

Median / p90 in ms, 1400 ms → 2100 ms.

| User | Layout | 1400 ms | 2100 ms |
| --- | --- | --- | --- |
| steady | core-1920 | 2500 / 3033 | 3200 / 3733 |
| steady | core-1366 | 2533 / 3000 | 3233 / 3700 |
| steady | spell-1920 | 2467 / 3133 | 3167 / 3833 |
| steady | spell-1366 | 2500 / 3167 | 3200 / 3867 |
| slow | core-1920 | 3867 / 5100 | 4567 / 5800 |
| slow | core-1366 | 3967 / 4967 | 4667 / 5667 |
| slow | spell-1920 | 3833 / 5267 | 4533 / 5967 |
| slow | spell-1366 | 3867 / 5367 | 4567 / 6067 |

## Open question

small-range makes 4.4 to 6.3 accidental selections per 100 intended at both dwell times. At 2100 ms that is 31 to 46 per layout, all with cause "other". It is under the gate of 10, and it was not investigated.

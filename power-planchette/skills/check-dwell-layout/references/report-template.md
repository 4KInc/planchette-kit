# Dwell check: <app name>, <views tested>

Date: <date>. Simulator: dwell-sim-mcp (Planchette Kit power 0.1.0). Task `{ eachTarget: 2 }`, 30 fps,
10 trials, seeds 1 to 10. Layouts: <list of files and screen sizes>.
App settings used: dwell time <ms>, other profile fields <list or "defaults">.

Simulated users are models built from published group averages. They are not real people and do not
predict how any one person will do. The numbers compare layouts and settings.

## Gate
The `reads-while-pointing` preset makes at most 10 accidental selections per 100 intended selections
on every layout, for the worst of seeds 1 to 10.

**<PASS or FAIL>** at <dwell> ms. Worst value <n> (<layout>, seed <n>).

## Results at <dwell> ms
Accidental selections per 100 intended; time to select in ms (median of the seed medians / median of the seed 90th percentiles).

| Layout | Preset | Worst | Median | Best | Time to select (median / p90) |
| --- | --- | --- | --- | --- | --- |
| ... | ... | ... | ... | ... | ... |

## Dwell time chosen by the multi-seed rule (only if the first value failed)
| Dwell (ms) | Worst over seeds 1 to 10, any layout | Gate |
| --- | --- | --- |
| ... | ... | ... |

Chosen: <ms>, the smallest tested dwell time whose worst seed passes on every layout.
Cost: median time to select <a> to <b> ms (see compare-dwell-settings).

## Other findings
- Any non-gated preset above 10: <preset, layout, value>.
- Layout problems from the export (no rest area, targets outside the viewport, page scrolls): <list>.
- Simulator warnings: <list or none>.

## Limits
This is the result for these layouts and this task only. The person can change every timing and
size in their own profile. This is not a medical device and not an assessment of any person.

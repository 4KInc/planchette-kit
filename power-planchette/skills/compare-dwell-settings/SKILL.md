---
name: compare-dwell-settings
description: Compare two dwell times for a hands-free web layout with the Planchette dwell simulator, and report how many accidental selections the longer one saves against the time it adds to each selection. Use when someone asks whether to raise or lower the dwell time, what a longer dwell costs, or how two dwell settings differ for head pointing.
---

# Compare two dwell settings

A longer dwell time prevents accidental selections and makes every selection slower. This skill
puts both numbers side by side for two values on the same layout, so the person who owns the app
can choose.

The worked example is the Board's change from 1400 ms to 2100 ms: for the preset
`reads-while-pointing` on the 1366×768 core layout, accidental selections fell from 50.6 to 2.4 per
100 intended, and the median time to select rose by about 700 ms. The tables are in
`references/board-1400-to-2100.md` (verbatim from `docs/board-gate.md` in
https://github.com/4KInc/planchette-kit).

Simulated users are models built from published group averages. They are not real people.

## Step 1: Fix what stays the same
Keep these identical for both settings, or the difference is not from the dwell time:
- the layout file (export it with the `check-dwell-layout` skill, steps 1 and 2),
- the other profile fields of the app,
- the users, the task `{ eachTarget: 2 }`, 30 fps, 10 trials per user,
- the seed (use 1).

Call the current value A and the candidate B, both in ms.

## Step 2: Get the accident and time numbers
Run the sweep script of the `check-dwell-layout` skill with both values and one seed:

```
node <check-dwell-layout folder>/scripts/sweep.mjs --layout <layout.json> \
  --dwell A,B --seeds 1 --presets steady,slow,reads-while-pointing
```

For each preset it prints accidental selections per 100 intended and the time to select (median /
p90, in ms) at A and at B. Use at least `reads-while-pointing` (the preset that reads while it
points, which the gate uses) and `steady`. Add more presets if the user cares about them. The
script exits 1 when the gate preset fails at some value; that does not matter here.

## Step 3: Get the paired verdict from `compare`
Call `compare` once per preset (about 30 KB each; do not ask for all six at once):

```
a: { layout: <layout>, profile: { dwellTime: A, ...app profile }, label: "A" }
b: { profile: { dwellTime: B, ...app profile }, label: "B" }
users: ["reads-while-pointing"], task: { eachTarget: 2 }, trialsPerUser: 10, fps: 30, seed: 1
```

Read `metrics.accidental.verdict`, `metrics.misses.verdict` and `metrics.timeToSelect.verdict`, with
their win counts. For the time added, take `pairs[].b.medianTimeMs − pairs[].a.medianTimeMs` over
the pairs where both sides have a time, and report the median of those differences. `compare` gives
win counts and verdicts, not a test of statistical significance, and it says so in `statement`.

## Step 4: Report
One table, one row per preset:

| Preset | Accidental per 100 intended, A → B | Misses (verdict) | Time to select, median, A → B (ms) | Added per selection |
| --- | --- | --- | --- | --- |

Then one plain sentence on the trade, with the numbers, for example: "At 2100 ms instead of 1400 ms,
`reads-while-pointing` makes 2.4 instead of 50.6 accidental selections per 100 intended, and every
selection takes about 700 ms longer (paired median over 10 trials)." Compute any percentage from two
medians and state which two numbers it comes from: for `steady` in the example tables, 2533 ms to
3233 ms is 700 ms, or 28 percent.

State the limits: one layout, one task, one seed for the table (the gate uses seeds 1 to 10, see
`check-dwell-layout`), models and not people.

## Rules
- Prefer slower and correct over faster and wrong: an accidental selection says the wrong thing on
  a person's behalf. That is this project's rule. Still, the time cost is real, and the person must be
  able to set their own dwell time. Say both.
- If B fails the gate (`check-dwell-layout`), say so, even if it is better than A.
- Do not change the app's default or the layout unless the user says so.
- Never claim a person will have these numbers. This is not a medical device.

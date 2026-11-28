---
name: check-dwell-layout
description: Check a hands-free web layout (head pointer, dwell, switch scanning) for accidental selections with the Planchette dwell simulator. Use when someone asks whether their dwell targets will select by accident, which dwell time to use, whether a layout works for people with tremor, slow movement or a small head range, or wants the seed-sweep gate for a dwell time.
---

# Check a layout for accidental dwell selections

A dwell target selects when the pointer rests on it for the dwell time. If a person's pointer
passes over, rests on, or shakes across a target they did not mean, the app says something on
their behalf. This skill runs simulated users through your layout and reports how often that
happens, then applies a fixed gate.

Simulated users are models built from published group averages. They are not real people and do
not predict how any one person will do. Use the result to compare layouts and settings.

## The gate (from this project's own apps)
For the preset `reads-while-pointing`, at most **10 accidental selections per 100 intended
selections**, on **every layout**, for the **worst of seeds 1 to 10**. The default dwell time is the
smallest tested dwell time that passes (the multi-seed rule). One seed can pass by luck, which is
why all ten are used. Worked examples, with the real numbers: `references/board-gate-example.md`
and `references/seance-gate-example.md` (copies of `docs/board-gate.md` and `docs/seance-gate.md`
in https://github.com/4KInc/planchette-kit).

## Step 1: Check what you need
1. Node.js 20 or later: run `node --version`.
2. The `dwell-sim` MCP server of this power is connected and lists `list_users`, `simulate` and
   `compare`. If not, tell the user to open the Powers panel and check the planchette power's MCP
   server, and stop.
3. The app marks its targets with `data-planchette-target="<id>"`, with `data-role="rest-area"` on
   a screen area that has no selectable target, and a `cancel` target. If it does not follow the
   skeleton's conventions, use the `build-on-the-skeleton` skill first. A layout with no rest area
   cannot be simulated honestly: the simulated person has nowhere to rest.

## Step 2: Export the layout at two screen sizes
Do this for every view of the app (each screen a person can reach is its own layout).
1. Set the browser window to 1366×768, open the view, and run the code in
   `references/export-targets.js` as one expression in the page. Use a browser tool's evaluate
   function, or the devtools console. Do not start the camera.
2. It returns `{ layout, problems }`. Save `layout` as JSON, for example
   `layouts/<view>-1366x768.json`. Report every entry in `problems` to the user. A target that is
   outside the viewport, or a page that scrolls, is a layout fault on its own: people who point
   with their head cannot scroll.
3. Repeat at 1920×1080: `layouts/<view>-1920x1080.json`.

## Step 3: Read the app's own settings
Find the dwell time the app uses (`planchette.getProfile().dwellTime`, or the app's default) and any
other profile field it sets, such as `headDeadZone` or `smoothingStrength`. The simulator runs the
skeleton's real engine, so it must run with the app's profile. Fields you do not pass are the
skeleton's defaults.

## Step 4: Run the seed sweep
A single `simulate` result is 65 KB to 340 KB. Twenty of them would fill your context. Run the
script in this skill instead. It starts the bundled simulator itself and prints one compact report.

```
node <this skill's folder>/scripts/sweep.mjs \
  --layout layouts/<view>-1366x768.json --layout layouts/<view>-1920x1080.json \
  --dwell <the app's dwell time in ms> [--profile '{"headDeadZone":2}']
```

It uses all presets, seeds 1 to 10, task `{ eachTarget: 2 }`, 30 fps and 10 trials, which are the
settings behind the gate. It finds the simulator at `dwell-sim-mcp.mjs`, three folders above the
script. If it reports that the file is missing, pass `--server <path to dwell-sim-mcp.mjs>`.
Exit code 0 is a pass, 1 a fail, 2 an error.

If you cannot run shell commands: call `list_users` once, then call `simulate` for each seed 1 to
10 and each layout with `users: ["reads-while-pointing"]`, `task: { eachTarget: 2 }`,
`profile: { dwellTime: <ms> }`, `trialsPerUser: 10`, `fps: 30`. Read only
`users[0].accidentalPer100Intended` and `users[0].timeToSelectMs`, and write the numbers down as
you go. Say that you tested one preset only.

## Step 5: Apply the gate
The script prints PASS or FAIL for the gate preset with the worst value, its layout and its seed.
Also read the table for the other presets. They are not part of the gate. If any is above 10,
report it as a finding, with its preset, layout and value. (In this project's own Board,
`small-range` makes 4 to 6 per 100 at 2100 ms; that was recorded as an open question, not a pass
or a fail.)

## Step 6: If it fails, pick the dwell time by the multi-seed rule
Run the script again with `--find`:

```
node <skill folder>/scripts/sweep.mjs --layout ... --layout ... --find \
  --dwell 1800,1900,2000,2100,2200,2400,2600,3000
```

It tests the values in ascending order and stops at the first one whose worst seed passes on every
layout. That value is the answer. If none passes (exit code 1), the layout is the problem and a
longer dwell time will not fix it. Say so. Then run `simulate` once, for the worst layout and seed
from the report with `users: ["reads-while-pointing"]`, and read only `suggestions` and the `cause`
of each entry of `accidentalSelections`. Report what the simulator names. Typical cause: a reader
who stops on a target to read, then moves on slowly, adds the pause and the slow crossing of the next
target to the dwell clock.

A longer dwell time is slower for everyone. Use the `compare-dwell-settings` skill to state the cost.

## Step 7: Report
Fill in `references/report-template.md`. Keep to one table per layout set, one verdict line, the
chosen dwell time and its cost, and the limits at the end.

## Rules
- Do not change the app's default dwell time, its layout or the gate's limit unless the user says
  so. Report the numbers and let them decide.
- The result holds for these layouts, this task and this profile. Say so.
- Never call a layout "safe" or "accessible". Say it passes or fails the gate, and what that
  measures.
- The person can always change every timing and size in their own profile. The default only has to
  be a good start.
- This is not a medical device and not a replacement for an assessment by a therapist.

# Methodology of the dwell simulator

## 1. Purpose and disclaimer

`dwell-sim-mcp` simulates head pointing against the real `@planchette/skeleton` engine and reports accidental selections, misses and time-to-select per simulated user and per target. The aim is to compare layouts and settings (for example two dwell times) before a person has to try them. This file lists every figure the model uses with its source, shows how each derived value was worked out, gives the reason for each value that was chosen instead of measured, and states what the model leaves out.

**Simulated users are models from published group averages, not real people. Use these results to compare layouts and settings.**

The same sentence is returned in the result of every tool. The presets are named after movement features, not diagnoses, and no result says anything about a specific condition or person.

## 2. The movement model

The simulated head is a pure function of simulated time. For each task entry the simulator plans a list of path segments from the user's parameters, the layout and seeded random draws, then evaluates the head angles at every frame time. The plan reads nothing from the engine. The only closed-loop step is that the next entry starts at the frame time of the event that resolved the previous one. Angles are in degrees, yaw positive to the right and pitch positive up.

### 2.1 Pixels and degrees

Every conversion between a pixel and a head angle uses the skeleton's `pointToRotation` and `rotationToPoint`, which share one mapping with the engine's head pointer. The simulator therefore cannot disagree with the engine about where a head angle lands. The mapping uses the centre the engine captured during the warm-up (the `result.centre` of the `centre` calibration step, or `(0, 0)` when the step ended without one). The head range stays absolute: yaw is clamped to `[-left, +right]` and pitch to `[-down, +up]`.

### 2.2 Movement time (Fitts' law)

For a move toward target T from pixel P0 to the aim pixel P1:

```
A  = distance from P0 to P1, in px
d  = (P1 - P0) / A                              (unit direction)
W  = T.width × |d.x| + T.height × |d.y|         (extent of the rectangle along d)
ID = log2(A / W + 1)                            (Shannon formulation [1][2])
MT = max(MT_MIN, 1000 × ID / TP)                (ms; TP is the user's throughput, bits/s)
```

`MT_MIN` is 150 ms. A move shorter than 0.5 px is no move: the user holds. `A` is measured to the aim point, so this is the nominal-distance form.

### 2.3 Minimum-jerk path

The head moves along a straight line in (yaw, pitch) space with the minimum-jerk profile [6]. For a segment from `a` to `b` that starts at `t0` and lasts `MT`:

```
τ       = clamp((t - t0) / MT, 0, 1)
s(τ)    = 10τ³ − 15τ⁴ + 6τ⁵
pose(t) = a + (b − a) × s(τ)
```

### 2.4 Aim point and end-point scatter

The aim is the centre of the target, mapped to head angles, plus a random offset on each axis. The offset has standard deviation

```
SD = min(W_angle / 4.133, SDcap)
```

where `W_angle` is the angular width of the target on that axis (measured between its two edges, so a target that spans the dead zone counts the extra turn), `4.133` is the factor between effective width and the standard deviation of end points [1][2], and `SDcap` is the user's scatter cap (0.6° for every preset). A narrow target therefore gets a smaller scatter than the cap, and a wide one gets the cap.

The offset is `z × SD` with `z` drawn from a normal distribution truncated at ±3 SD. The draw uses one uniform per axis and inverse transform: `z = probit(Φ(−3) + u × (Φ(3) − Φ(−3)))`, where `probit` is Peter J. Acklam's rational approximation of the normal quantile function (relative error at most 1.135e-9 over the range used; algorithm as reproduced at [stackedboxes.org](https://stackedboxes.org/2017/05/01/acklams-normal-quantile-function/)). The result is clamped to the head range. Because `|z| < 3`, the aim can lie up to about 0.73 W from the target centre, so an aim can fall outside a narrow target. That is a legitimate miss.

### 2.5 Tremor

Tremor is added to the base pose on one axis (yaw by default):

```
offset(t) = (a(t) / 2) × sin(2π f t / 1000 + φ)       degrees, t in ms
a(t)      = a0 × (1 + 0.2 × d(t))                      a0 = peak-to-peak size, in degrees
φ         = 2π × u                                      one random phase per trial
d(t)      = lerp(U(j), U(j+1), smoothstep(x))           j = floor(t / 5000), x = t / 5000 − j
U(i)      = 2u − 1                                      a random value in [−1, 1) for every 5 s knot
smoothstep(x) = x² (3 − 2x)
```

So the size drifts within ±20 % of its nominal value and changes over about 5 s. Tremor is on during the warm-up as well. It is exactly 0 when the size or the frequency is 0. A custom tremor frequency must be 0 (off) or 1–15 Hz: a non-zero value below 1 Hz would be a constant tilt over a trial, not tremor, so it is rejected.

### 2.6 Tracking noise

```
noise(t) = n × (2u₁ − 1, 2u₂ − 1)           uniform on yaw and pitch, independent
head(t)  = clampToHeadRange(base(t) + tremor(t) + noise(t))
```

`n` is the tracking noise given as a peak: each axis is uniform in `[−n, +n]`. The simulated user's noise is 0 for every preset (see section 5).

### 2.7 Reading pauses

For each entry the simulator samples the straight path from the start pose to the aim and finds every other selectable target (not a rest area, not the aimed one) that the path crosses. For each crossed target a seeded draw decides whether the user stops on it, with the user's chance. If so, the stop length is uniform between the user's minimum and maximum. The stop is at `READING_DEPTH = 0.5` of the crossing, that is half way between the point where the path enters the target and the point where it leaves it. The move is split there: the pause is a hold, and the next piece starts at rest as a new minimum-jerk move. Each piece gets its own Fitts' law movement time.

### 2.8 Entry timeline

Each entry starts with a reaction wait (500 ms for every preset) at the starting pose, then the move (with any reading pauses), then a hold on the aim point until the entry resolves or the analysis window ends. The window is measured from the end of the reaction wait. An entry resolves when an intended selection happens or when its deadline passes (a miss).

### 2.9 The start of session

A trial begins with a warm-up in which the head rests at the angle `(0, 0)` while the engine captures its centre (tremor and noise are on). After that, when the layout has a rest-area target, the user waits the reaction time and then moves from the screen centre to an aim point inside the first rest-area target, using the same aim scatter, Fitts' law and minimum-jerk path as any other move (the start path). No reading pause is applied on the way. If the layout has no rest area, the user stays at the screen centre and the start of session has zero length. If the rest point lies outside the user's head range, the clamp applies and the trial carries the warning `start-clamped`.

The first task entry starts when the start path ends. The warm-up and the start of session are in no time-to-select value.

An event (a `select` or `cancel`) that happens before the end of the start of session, including during the warm-up, is a start-of-session event. It is reported with the activity `waiting` and the cause `start`. It is a third category, next to intended and accidental, and it is counted in neither the accidental count nor the rate per 100 intended selections. Its count is reported separately per user (`startOfSession`) and per target (`startCount`).

### 2.10 Intended or accidental

The glossary calls both "moving toward the target" intended and "before the user meant to select it (passing over)" accidental. The simulator resolves this by testing the planned position: while the user is moving, an event on the aimed target counts as intended once the planned position (the planned pose without tremor and noise, mapped to pixels) is inside the target. An event on the aimed target while the planned position is still outside it (tremor or noise put the pointer there early) is accidental, with cause `early-on-intended-target` or `tremor-at-edge`. While holding on the aim point, a selection on the aimed target is intended. During a wait or a reading pause nothing is intended. An aimed cancel-role target is matched by a `cancel` event that carries its id.

### 2.11 Medians and percentiles

Time-to-select is reported as a median and a 90th percentile, both by nearest rank: `sorted[ceil(p × n) − 1]`. The median is the nearest-rank p50, `sorted[ceil(0.5 × n) − 1]`. For an even count this is the lower middle value, not the mean of the two middle values. Both are `null` when there is no sample. The accidental rate is `accidental / intended × 100`, `null` when there is no intended selection, and is rounded to one decimal in the tool output.

## 3. Figures, references and chosen values

The three tables below (Figures, References, Chosen values, and the notes on figure sources) are the output of `generateMethodologyTables` in `scripts/generate-methodology-tables.ts`, pasted unchanged. They come from the same typed data (`src/figures.ts`, `src/presets.ts`) that `list_users` returns, so a citation cannot drift from its number. Regenerate them with `npm run methodology:tables --workspace=tools/dwell-sim-mcp`. The test `test/methodology.test.ts` fails if this file and the generator disagree.

<!-- generated: begin -->
### Figures

| Figure | Value | Reference |
| --- | --- | --- |
| Fitts' law, Shannon formulation; effective width We = 4.133 × SD of end points; throughput = IDe / MT | method | [1] [2] |
| Head pointing throughput, people without motor impairments, head-mounted display (41 people; mean over click and dwell groups; 300 ms dwell in the dwell group) | 2.47 bits/s (mouse 3.24, gaze 2.13); time to activate 850 ms. Upper bound, context only: not used by a preset. | [[3]](https://www.yorku.ca/mack/etra2018.html) |
| Head effective width, same study | about 72 px (about 2.5 degrees). Used for the scatter cap. Derivation: SD = We / 4.133 = 72 / 4.133 = 17.4 px; 2.5 / 4.133 = 0.6 degrees. | [[3]](https://www.yorku.ca/mack/etra2018.html) |
| Head pointing throughput with a phone's front camera | 0.61 bits/s with motor impairments, 0.90 bits/s without; IDs 1.62–5.20 bits | [[4]](https://research.google/pubs/designing-and-evaluating-head-based-pointing-on-smartphones-for-people-with-motor-impairments/) |
| Head pointing throughput, mobile head tracker | 1.42 bits/s. Used by `steady`. | [[5]](https://www.yorku.ca/mack/ijhcs2018.html) |
| Minimum-jerk movement path | method | [6] |
| Frequency of most pathological tremors | 4–8 Hz | [[7]](https://pmc.ncbi.nlm.nih.gov/articles/PMC6530552/) |
| Physiological tremor | 8–12 Hz | [[7]](https://pmc.ncbi.nlm.nih.gov/articles/PMC6530552/) |
| Parkinsonian rest tremor | 4–7 Hz | [[7]](https://pmc.ncbi.nlm.nih.gov/articles/PMC6530552/) |
| Intention (cerebellar) tremor | below 5 Hz | [[7]](https://pmc.ncbi.nlm.nih.gov/articles/PMC6530552/) |
| Head tremor, essential tremor (n = 78) | peak 4.25 ± 0.88 Hz; 12.3 ± 15.3 deg/s between successive extrema | [[8]](https://pmc.ncbi.nlm.nih.gov/articles/PMC6806605/) |
| Head tremor, cervical dystonia (n = 96) | peak 4.37 ± 1.22 Hz; 7.77 ± 6.72 deg/s | [[8]](https://pmc.ncbi.nlm.nih.gov/articles/PMC6806605/) |
| Head tremor size in degrees (derived) | ET mean ≈ 0.46° peak to peak; CD mean ≈ 0.28°. "ET mean + 2 SD = 1.6°" is chosen, not a percentile, because the SD exceeds the mean. | [[8]](https://pmc.ncbi.nlm.nih.gov/articles/PMC6806605/) |
| Minimum supported head range | ±3° | none |
| Reference head range | ±15° | none |

### References

1. Soukoreff RW, MacKenzie IS. Towards a standard for pointing device evaluation, perspectives on 27 years of Fitts' law research in HCI. *International Journal of Human-Computer Studies* 61 (2004) 751–789.
2. MacKenzie IS. Fitts' law as a research and design tool in human-computer interaction. *Human-Computer Interaction* 7 (1992) 91–139.
3. Hansen JP, Rajanna V, MacKenzie IS, Bækgaard P. A Fitts' law study of click and dwell interaction by gaze, head and mouse with a head-mounted display. COGAIN @ ETRA 2018. doi:10.1145/3206343.3206344. <https://www.yorku.ca/mack/etra2018.html>
4. Cicek M, Dave A, Feng W, Huang MX, Haines JK, Nichols J. Designing and evaluating head-based pointing on smartphones for people with motor impairments. ASSETS 2020. doi:10.1145/3373625.3416994. <https://research.google/pubs/designing-and-evaluating-head-based-pointing-on-smartphones-for-people-with-motor-impairments/>
5. Roig-Maimó MF, MacKenzie IS, Manresa-Yee C, Varona J. Head-tracking interfaces on mobile devices: evaluation using Fitts' law and a new multi-directional corner task for small displays. *International Journal of Human-Computer Studies* 112 (2018) 1–15. doi:10.1016/j.ijhcs.2017.12.003. <https://www.yorku.ca/mack/ijhcs2018.html>
6. Flash T, Hogan N. The coordination of arm movements: an experimentally confirmed mathematical model. *Journal of Neuroscience* 5(7) (1985) 1688–1703.
7. Bhatia KP et al. Consensus statement on the classification of tremors, from the Task Force on Tremor of the International Parkinson and Movement Disorder Society. *Movement Disorders* 33(1) (2018) 75–87. doi:10.1002/mds.27121. <https://pmc.ncbi.nlm.nih.gov/articles/PMC6530552/>
8. Berbakov L, Jovanović Č, Svetel M, Vasiljević J, Dimić G, Radulović N. Quantitative assessment of head tremor in patients with essential tremor and cervical dystonia by using inertial sensors. *Sensors* 19(19) (2019) 4246. doi:10.3390/s19194246. <https://pmc.ncbi.nlm.nih.gov/articles/PMC6806605/>

### Chosen values

| Parameter | Reason | Presets |
| --- | --- | --- |
| tremorFrequencyHz | chosen: no tremor | steady, slow, small-range, reads-while-pointing |
| tremorPeakToPeakDeg | chosen: no tremor | steady, slow, small-range, reads-while-pointing |
| tremorAxis | chosen: [8] measured the single principal axis of head tremor, so applying the full size to both axes would overstate it | all presets |
| headRangeDeg | chosen: our own default calibration constant, not a published human range | steady, slow, head-tremor, strong-head-tremor, reads-while-pointing |
| readingPauseChancePct | chosen: no reading pauses | steady, slow, head-tremor, strong-head-tremor, small-range |
| readingPauseLengthMs | chosen: no reading pauses | steady, slow, head-tremor, strong-head-tremor, small-range |
| tremorDriftFraction | random walk keeping the size within ±20 % of nominal, changing over about 5 s; tremor size varies slowly in real recordings, but [8] gives no figure | all presets |
| reactionTimeMs | a choice reaction time for a user who has to pick the next target | all presets |
| trackingNoiseDeg | chosen: not measured yet; input-core Task 14.9 will measure it from our own face clip and replace it | all presets |
| scanReactionTimeMs | same as reaction time | all presets |
| scanLatePressChancePct | one item late, to exercise scan interval settings | all presets |
| scanPressDurationMs | must be below cancelHoldTime (minimum 1000 ms) | all presets |
| tremorPeakToPeakDeg | ET mean + 2 SD; the SD exceeds the mean, so this is not a percentile (see head-tremor-deg row, [8]) | strong-head-tremor |
| headRangeDeg | input-core minimum supported head range (MIN_RANGE), see the min-head-range row | small-range |
| readingPauseChancePct | 30 % chance per passed target; the low end of the length is below the 400 ms minimum dwell and the high end is below the 1000 ms default, so it exercises dwell settings | reads-while-pointing |
| readingPauseLengthMs | 300–900 ms uniform; below the 400 ms minimum dwell at the low end and below the 1000 ms default at the high end | reads-while-pointing |

### Figure-source notes

| Parameter | Note | Presets |
| --- | --- | --- |
| scatterCapDeg | derived: SD = We / 4.133 = 2.5 / 4.133 = 0.6 degrees | all presets |
| throughputBitsPerS | chosen pairing: one shared base (0.90 bits/s, without motor impairments), so each preset differs in one feature | head-tremor, strong-head-tremor, small-range, reads-while-pointing |
<!-- generated: end -->

## 4. Derived values

Three values in the tables are derived from the published figures, not copied.

**Scatter cap.** Hansen et al. [3] report a head effective width of about 72 px, which is about 2.5° for their display. The effective width is 4.133 × the standard deviation of the end points [1][2], so the standard deviation is We / 4.133:

- 72 / 4.133 = 17.4 px
- 2.5° / 4.133 = 0.6°

The simulator works in degrees, so the cap is 0.6°. The figure comes from head pointing in a head-mounted display, not from a webcam.

**Tremor size.** Berbakov et al. [8] give the tremor amplitude as the difference between successive extrema of the angular-velocity signal, in deg/s, with the peak frequency. For a sinusoid of frequency f and peak-to-peak size p, the angular velocity swings by 2π f p between its extrema, so p = (deg/s between extrema) / (2π f):

- essential tremor: 12.3 / (2π × 4.25) = 0.46° peak to peak
- cervical dystonia: 7.77 / (2π × 4.37) = 0.28° peak to peak

Only the essential-tremor value is used by a preset (`head-tremor`).

**Strong tremor.** "ET mean + 2 SD = 1.6°" is a chosen value, not a percentile. In [8] the standard deviation (15.3 deg/s) is larger than the mean (12.3 deg/s), so mean + 2 SD does not correspond to a percentile of the measured group. The value 1.6° is used for `strong-head-tremor` as a clearly stronger tremor, and it is above the 1° that the head-pointer smoothing is tuned for, so a run with it carries the note `TREMOR_ABOVE_TUNED`.

## 5. Chosen values and their reasons

Where no published figure exists, the value is chosen and the reason is given in the Chosen values table above (one row per parameter and reason, with the presets that use it). In short:

- **Reading pauses.** `reads-while-pointing` stops on 30 % of the targets it passes, for 300–900 ms uniform. The low end is below the 400 ms minimum dwell and the high end is below the 1000 ms default, so the preset exercises dwell settings. All other presets have no pauses.
- **Reaction time, 500 ms.** A choice reaction time for a user who has to pick the next target. It is used before each entry and before the start path.
- **Tracking noise, 0°.** Not measured yet. input-core Task 14.9 will measure it from our own face clip and replace this value, so every preset runs without noise until then.
- **Tremor size drift, 20 %.** Tremor size varies slowly in real recordings, but [8] gives no figure. The model keeps the size within ±20 % of nominal and changes it over about 5 s.
- **Tremor axis, yaw.** [8] measured the single principal axis of head tremor, so applying the full size to both axes would overstate it.
- **Head range, ±15°.** Our own default calibration constant, not a published human range. `small-range` uses ±3°, the smallest range input-core supports.
- **Throughput pairing, 0.90 bits/s.** `head-tremor`, `strong-head-tremor`, `small-range` and `reads-while-pointing` share one base (the 0.90 bits/s of [4] for people without motor impairments), so each differs from the base in one feature. `steady` uses 1.42 bits/s [5] and `slow` uses 0.61 bits/s [4].
- **Scan parameters.** Reaction time 500 ms (same as the reaction time), 10 % chance of a press one item late (to exercise scan interval settings) and a press held for 150 ms (it must be below `cancelHoldTime`, whose minimum is 1000 ms). They are stored with the presets and are not used yet, because scan mode is deferred (section 6).

Constants of the simulator that are chosen, with the values in the code:

| Constant | Value | Reason |
| --- | --- | --- |
| `MT_MIN` | 150 ms | Shortest movement time of a real move. It keeps a move at least two frames long at 15 fps (133 ms), so the minimum-jerk path is sampled at more than one point. The fastest ballistic head turns reported for pointing are of that order, but the Figures table gives no number, so it is chosen. |
| `MIN_MOVE_PX` | 0.5 px | A move shorter than this is no move; the user holds. |
| `READING_DEPTH` | 0.5 | A reading pause is half way through the crossing of the target, so the stop is inside it. |
| `MAX_PATH_SAMPLES` | 2000 | Most samples taken along a straight path to find crossings. |
| `LAG_ALLOWANCE_MS` | 500 ms | After a reading pause the smoothed pointer can still be on the target. An accidental selection within `graceTime` plus 500 ms of the end of the pause is labelled `reading-pause`. 500 ms is above the 400 ms smoother lag measured at smoothing strength 0.9. |
| Noise as a peak | uniform in `[−n, +n]` | The requirement says "size" of noise. It is read as the peak of a uniform draw per axis, which keeps the noise bounded and the property tests simple. |
| Truncation | ±3 SD | The scatter draw cannot produce an extreme value, and the number of draws per aim is fixed (two). |
| Tremor size drift knots | every 5 s, ±20 % | See the drift row above. |
| `TREMOR_TUNED_DEG` | 1° | Peak-to-peak size above which a user gets the `TREMOR_ABOVE_TUNED` note; the head-pointer smoothing is tuned for tremor up to this size. |
| `MIN_EVENTS` | 3 | Fewest events on a target before a reading-pause or tremor-at-edge suggestion is made. |
| `SHARE_THRESHOLD` | 0.5 | A cause must be strictly more than half of a target's events to give a suggestion. |
| `COMMON_USE_FRACTION` | 0.2 | A target is commonly used when it makes up at least 20 % of the task entries. |

An earlier design had a settling period after the warm-up (`SETTLE_MS`). It was replaced by the start of session (section 2.9), so no settle time exists in the simulator.

Custom users may override parameters inside fixed ranges, chosen to cover the figures with margin: throughput 0.3–4 bits/s; tremor frequency 0 (off) or 1–15 Hz; tremor size 0–5° peak to peak; head range 3–60° per direction; reaction time 150–1500 ms; reading-pause chance 0–100 %, length 0–3000 ms; scatter cap 0.1–3°; tracking noise 0–2°; analysis window 2–120 s. The default analysis window is 10 s: slow users at ID 5.2 need 8.5 s of movement, so callers can raise it up to 120 s.

## 6. Limits

What the model leaves out (Out of scope):

- Eye tracking, hand pointing and touch.
- Fatigue over a long session, learning effects, and changes in a person's condition.
- Users who react to on-screen feedback, and camera delay. The model is open loop.
- Tracking dropouts (face lost).
- MediaPipe and the camera adapter's rotation maths. The simulator feeds engine-level rotation.
- Loading a live web page. The layout comes from `getTargets()`; the app or a hook exports it.
- Any claim about a specific condition or person. Presets are named after movement features, not diagnoses.

Further limits of the model:

- **Tremor is a pure sinusoid.** The derived sizes assume a pure sinusoid at the peak frequency. Real tremor is less regular, and in cervical dystonia often irregular. Results for the tremor presets show the effect of a regular tremor of that size and frequency, not of a person's tremor.
- **Open loop.** The simulated head does not react to what the pointer does. It does not correct an overshoot or slow down when the pointer is near an edge. The plan is fixed before the engine sees any sample, except that the next entry starts when the previous one resolves.
- **Engine-level rotation.** The simulator feeds head angles to the engine, not camera images. MediaPipe and the camera adapter's rotation maths are not modelled, and face-tracking error appears only through the tracking-noise parameter, which is 0 for every preset.
- **Tremor frequency.** A custom tremor frequency is 0 (tremor off) or 1–15 Hz. A value between 0 and 1 Hz is rejected because it is a constant tilt over a trial, not tremor.
- **Scatter cap.** It comes from head pointing in a head-mounted display [3], not from a webcam or a phone.
- **Scan mode is deferred.** Only `head + dwell` is supported. A request for `scan` (or any other mode) is rejected with `UNSUPPORTED_MODE`. The scan parameters in the presets are placeholders until scan mode is built.
- **Group averages.** Throughput and tremor values are means of published groups. A real person differs from a mean.

The simulator plans with the centre the engine captured, as a real user's pointer does.

Frame rate: at 15 fps the smoothed pointer arrives later than at 60 fps (median +70 ms, up to about 270 ms in the measured sample); time-to-select at low fps includes this.

Whether a gap off a target continues a stay or resets it can differ between frame rates when the gap is close to graceTime.

## 7. How determinism works

The same request gives the same result. Every random value is a draw `u(seed, userKey, trial, purpose, k, j)`: a hash of its own key, not a value taken from a generator that advances. A draw therefore cannot be shifted by anything else that happened in the run. A miss, a different user list or a different frame rate never changes another draw.

- **Seed.** The request seed is an integer from −2147483648 to 2147483647 (default 1).
- **Stream.** A stream is `hash32(seed, userKey, trialIndex, purpose)`, where `purpose` names what the draw is for: aim, start, tremor phase, tremor drift knot, reading-pause chance, reading-pause length, tracking noise, scan late press and task order. A draw is the stream plus one or two counters `k` and `j` (for example the entry index and the axis), hashed into a uniform value with 53 bits.
- **User key.** The key comes from the user: the hash of the name for a preset, and of the name and the resolved parameters for a custom user. It does not come from the position in the list, so adding, removing or reordering users never changes another user's paths. Two identical users in one request give identical results.
- **Keys of draws.** The aim is keyed by the entry index, so a miss or an early resolution never shifts a later aim. The start-of-session aim has its own purpose, so it never shifts an entry's aim. Reading-pause draws are keyed by the entry index and the layout target index (ids in UTF-16 order). Tracking noise is keyed by the simulated time in microseconds, so it does not depend on the frame rate.
- **Task order.** `{ eachTarget: n }` is shuffled round by round from the stream `taskOrder = stream(seed, 0, 0, TaskOrder)`. This stream has user key 0 and trial index 0 because the task is built once per request, before any user exists, and `compare` needs the same task for both configurations. A repeat at a round boundary is repaired by swapping the first two entries of the round; the repair draws nothing.
- **Compare.** `compare` runs both configurations with the same seed, user keys and trial indices. Every key depends on the entry index, the layout target index or the time, never on the profile, so both sides consume the same draws. If the two configurations differ only in the timing settings (`dwellTime`, `graceTime`, `postSelectionPause`, `autoRepeatInterval`, `smoothingStrength`), the head samples are identical up to the first differing event.
- **No clock.** The result has no wall-clock time and no random identifier.

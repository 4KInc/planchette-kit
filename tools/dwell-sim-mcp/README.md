# dwell-sim-mcp

A stdio MCP server that simulates head-pointing users working through a layout, using the real Planchette skeleton as the engine. It reports accidental selections, misses and time-to-select per user and per target, so you can compare layouts and profile settings before testing with people.

**Simulated users are models built from published group averages, not real people.** Use the results to compare layouts and settings. They do not predict how any one person will perform. See [METHODOLOGY.md](METHODOLOGY.md) for the movement model, the source of every number and the limits.

This package is private (`"private": true`). It is not published to npm.

## Requirements

- Node.js 20 or later (`engines`: `">=20"`).
- A built skeleton. The simulator imports `@planchette/skeleton` from its `dist` folder. If the server cannot resolve it, it writes "Build the skeleton first" to stderr and exits with code 1. From the repository root, build the skeleton and this package with:

```sh
npm run build:sim
```

`npm run build:sim` runs `npm run build --workspace=skeleton` and then builds this package. To build only the skeleton, run `npm run build --workspace=skeleton`.

## Start the server

From the repository root, after building:

```sh
node tools/dwell-sim-mcp/dist/server.js
npm run sim --silent
npx dwell-sim-mcp
```

`npx dwell-sim-mcp` works only where the package is linked or installed, for example inside this workspace after `npm install`.

**stdout is the protocol channel.** The server talks to the client over stdin and stdout and writes its own logs to stderr. Without `--silent`, npm prints a banner on stdout, which corrupts the protocol. Clients should therefore launch the server with `node …/dist/server.js`, as in the configuration below. If you use npm, always pass `--silent`.

## Configure Kiro

Kiro reads MCP servers from `.kiro/settings/mcp.json` (workspace) or `~/.kiro/settings/mcp.json` (user). Each entry under `mcpServers` takes `command`, `args` and optionally `env`, `disabled`, `autoApprove` and `disabledTools`. The format is as documented on [Kiro: MCP configuration](https://kiro.dev/docs/mcp/configuration/) (checked on the day this README was written).

```json
{
  "mcpServers": {
    "dwell-sim": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/planchette-kit/tools/dwell-sim-mcp/dist/server.js"
      ],
      "disabled": false
    }
  }
}
```

Replace `/ABSOLUTE/PATH/TO` with the real location of the repository. The path must be absolute because the client's working directory is not the repository. Kiro reconnects when you save the file.

## Tools

Each tool returns its result as `structuredContent` and as one text item holding the same object as compact JSON. Every result carries the disclaimer. The examples below come from a real run (see [Where the examples come from](#where-the-examples-come-from)).

### `list_users`

Takes no input. Returns the six presets (`steady`, `slow`, `head-tremor`, `strong-head-tremor`, `small-range`, `reads-while-pointing`) with every parameter value and its source, and the allowed range of each parameter you can override in a custom user.

Excerpt of the real output (one preset, two parameters, two ranges; the full output lists all six presets with every parameter and all ten ranges):

<!-- example: list-users-output-excerpt -->
```json
{
  "users": [
    {
      "name": "steady",
      "description": "Steady head pointing at the mobile head-tracker throughput, no tremor, no reading pauses.",
      "parameters": {
        "throughputBitsPerS": {
          "value": 1.42,
          "source": {
            "row": "Head pointing throughput, mobile head tracker",
            "ref": 5,
            "citation": "Roig-Maimó MF, MacKenzie IS, Manresa-Yee C, Varona J. Head-tracking interfaces on mobile devices: evaluation using Fitts' law and a new multi-directional corner task for small displays. *International Journal of Human-Computer Studies* 112 (2018) 1–15. doi:10.1016/j.ijhcs.2017.12.003."
          }
        },
        "tremorFrequencyHz": {
          "value": 0,
          "source": "chosen: no tremor"
        }
      }
    }
  ],
  "customRanges": {
    "throughputBitsPerS": {
      "min": 0.3,
      "max": 4,
      "unit": "bits/s"
    },
    "tremorFrequencyHz": {
      "min": 1,
      "max": 15,
      "unit": "Hz"
    }
  },
  "disclaimer": "Simulated users are models from published group averages, not real people. Use these results to compare layouts and settings."
}
```

### `simulate`

Runs each user through the task on one layout. Reports metrics per user and per target, every accidental selection with its cause, suggestions, warnings and notes.

Input: `layout`, `users` and `task` are required. `profile` (a partial skeleton profile), `mode` (default `head + dwell`), `trialsPerUser` (1 to 50, default 10), `fps` (15, 30 or 60, default 30), `analysisWindowS` (2 to 120, default 10) and `seed` (integer, default 1) are optional. `users` holds up to 12 preset names or custom users `{ name, base?, overrides }`. `task` is a list of target ids or `{ "eachTarget": n }`. The ranges for custom overrides come from `list_users`.

Request:

<!-- example: simulate-input -->
```json
{
  "layout": {
    "screen": {
      "width": 1280,
      "height": 720
    },
    "targets": [
      {
        "id": "menu",
        "rect": {
          "x": 40,
          "y": 40,
          "width": 200,
          "height": 120
        }
      },
      {
        "id": "next",
        "rect": {
          "x": 1040,
          "y": 40,
          "width": 200,
          "height": 120
        }
      },
      {
        "id": "rest",
        "rect": {
          "x": 540,
          "y": 600,
          "width": 200,
          "height": 80
        },
        "role": "rest-area"
      }
    ]
  },
  "profile": {
    "dwellTime": 1000
  },
  "users": [
    "head-tremor"
  ],
  "task": {
    "eachTarget": 2
  },
  "trialsPerUser": 2,
  "seed": 1
}
```

Result. The request asks for 2 trials per user to keep the example short; the default is 10.

<!-- example: simulate-output -->
```json
{
  "seed": 1,
  "parameters": {
    "layout": {
      "screen": {
        "width": 1280,
        "height": 720
      },
      "targets": [
        {
          "id": "menu",
          "rect": {
            "x": 40,
            "y": 40,
            "width": 200,
            "height": 120
          },
          "autoRepeat": false,
          "role": "default"
        },
        {
          "id": "next",
          "rect": {
            "x": 1040,
            "y": 40,
            "width": 200,
            "height": 120
          },
          "autoRepeat": false,
          "role": "default"
        },
        {
          "id": "rest",
          "rect": {
            "x": 540,
            "y": 600,
            "width": 200,
            "height": 80
          },
          "autoRepeat": false,
          "role": "rest-area"
        }
      ]
    },
    "mode": "head + dwell",
    "fps": 30,
    "analysisWindowS": 10,
    "trialsPerUser": 2,
    "task": {
      "eachTarget": 2
    },
    "profile": {
      "dwellTime": 1000
    },
    "users": [
      {
        "name": "head-tremor",
        "params": {
          "throughputBitsPerS": 0.9,
          "tremorFrequencyHz": 4.25,
          "tremorPeakToPeakDeg": 0.46,
          "tremorAxis": "yaw",
          "tremorDriftFraction": 0.2,
          "headRangeDeg": {
            "left": 15,
            "right": 15,
            "up": 15,
            "down": 15
          },
          "reactionTimeMs": 500,
          "readingPauseChancePct": 0,
          "readingPauseLengthMs": {
            "min": 0,
            "max": 0
          },
          "trackingNoiseDeg": 0,
          "scatterCapDeg": 0.6,
          "scanReactionTimeMs": 500,
          "scanLatePressChancePct": 10,
          "scanPressDurationMs": 150
        },
        "effectiveProfile": {
          "mode": "head + dwell",
          "startCameraOnLoad": false,
          "switchGesture": "jaw open",
          "switchBinding": " ",
          "headGain": 1,
          "headDeadZone": 0.5,
          "smoothingStrength": 0.5,
          "dwellTime": 1000,
          "graceTime": 150,
          "postSelectionPause": 500,
          "autoRepeatInterval": 1000,
          "scanInterval": 1200,
          "scanLoopsBeforePause": 3,
          "switchAcceptanceTime": 0,
          "gestureAcceptanceTime": 300,
          "gestureThreshold": 0.5,
          "gestureReleaseThreshold": 0.3,
          "cancelByHold": true,
          "cancelHoldTime": 2000,
          "noFaceTimeout": 10000,
          "inputTimeout": 2000,
          "calibrationRangeLeft": 15,
          "calibrationRangeRight": 15,
          "calibrationRangeUp": 15,
          "calibrationRangeDown": 15,
          "calibrationStillnessThreshold": 2,
          "calibrationStillnessTime": 1500,
          "calibrationStepTimeout": 6000,
          "targetSize": 96,
          "targetSpacing": 16
        }
      }
    ]
  },
  "users": [
    {
      "trials": 2,
      "intended": 8,
      "accidental": 0,
      "startCount": 0,
      "accidentalPer100Intended": 0,
      "misses": 0,
      "timeToSelectMs": {
        "median": 3233.333333333334,
        "p90": 3433.333333333334
      },
      "causes": {
        "reading-pause": 0,
        "pass-over": 0,
        "tremor-at-edge": 0,
        "repeat": 0,
        "waiting": 0,
        "early-on-intended-target": 0,
        "other": 0
      },
      "activities": {
        "waiting": 0,
        "moving": 0,
        "reading pause": 0,
        "holding on the aim point": 0
      },
      "startOfSession": {
        "count": 0,
        "byTarget": []
      },
      "name": "head-tremor",
      "perTarget": [
        {
          "targetId": "menu",
          "intended": 4,
          "accidental": 0,
          "startCount": 0,
          "accidentalPer100Intended": 0,
          "misses": 0,
          "timeToSelectMs": {
            "median": 3233.333333333334,
            "p90": 3433.333333333334
          },
          "causes": {
            "reading-pause": 0,
            "pass-over": 0,
            "tremor-at-edge": 0,
            "repeat": 0,
            "waiting": 0,
            "early-on-intended-target": 0,
            "other": 0
          },
          "activities": {
            "waiting": 0,
            "moving": 0,
            "reading pause": 0,
            "holding on the aim point": 0
          }
        },
        {
          "targetId": "next",
          "intended": 4,
          "accidental": 0,
          "startCount": 0,
          "accidentalPer100Intended": 0,
          "misses": 0,
          "timeToSelectMs": {
            "median": 2900.1949345777593,
            "p90": 3233.333333333334
          },
          "causes": {
            "reading-pause": 0,
            "pass-over": 0,
            "tremor-at-edge": 0,
            "repeat": 0,
            "waiting": 0,
            "early-on-intended-target": 0,
            "other": 0
          },
          "activities": {
            "waiting": 0,
            "moving": 0,
            "reading pause": 0,
            "holding on the aim point": 0
          }
        }
      ]
    }
  ],
  "accidentalSelections": [],
  "suggestions": [],
  "warnings": [
    "NO_CANCEL_TARGET: the layout has no cancel-role target. Accessibility rule: head-pointer layouts place a cancel target."
  ],
  "notes": [],
  "disclaimer": "Simulated users are models from published group averages, not real people. Use these results to compare layouts and settings."
}
```

### `compare`

Runs the same users, task and seed on two configurations, A and B, and reports one pair per user and trial and one verdict per metric (accidental selections, misses, time-to-select). B uses A's layout when it gives none. If it gives one, the two layouts must have the same target ids. The counts are not a test of statistical significance.

Request:

<!-- example: compare-input -->
```json
{
  "a": {
    "layout": {
      "screen": {
        "width": 1280,
        "height": 720
      },
      "targets": [
        {
          "id": "menu",
          "rect": {
            "x": 40,
            "y": 40,
            "width": 200,
            "height": 120
          }
        },
        {
          "id": "next",
          "rect": {
            "x": 1040,
            "y": 40,
            "width": 200,
            "height": 120
          }
        },
        {
          "id": "rest",
          "rect": {
            "x": 540,
            "y": 600,
            "width": 200,
            "height": 80
          },
          "role": "rest-area"
        }
      ]
    },
    "profile": {
      "dwellTime": 1000
    },
    "label": "dwell 1000"
  },
  "b": {
    "profile": {
      "dwellTime": 1400
    },
    "label": "dwell 1400"
  },
  "users": [
    "head-tremor"
  ],
  "task": {
    "eachTarget": 2
  },
  "trialsPerUser": 2,
  "seed": 1
}
```

Result:

<!-- example: compare-output -->
```json
{
  "seed": 1,
  "parameters": {
    "shared": {
      "mode": "head + dwell",
      "fps": 30,
      "analysisWindowS": 10,
      "trialsPerUser": 2,
      "task": {
        "eachTarget": 2
      },
      "users": [
        {
          "name": "head-tremor",
          "params": {
            "throughputBitsPerS": 0.9,
            "tremorFrequencyHz": 4.25,
            "tremorPeakToPeakDeg": 0.46,
            "tremorAxis": "yaw",
            "tremorDriftFraction": 0.2,
            "headRangeDeg": {
              "left": 15,
              "right": 15,
              "up": 15,
              "down": 15
            },
            "reactionTimeMs": 500,
            "readingPauseChancePct": 0,
            "readingPauseLengthMs": {
              "min": 0,
              "max": 0
            },
            "trackingNoiseDeg": 0,
            "scatterCapDeg": 0.6,
            "scanReactionTimeMs": 500,
            "scanLatePressChancePct": 10,
            "scanPressDurationMs": 150
          }
        }
      ]
    },
    "a": {
      "label": "dwell 1000",
      "layout": {
        "screen": {
          "width": 1280,
          "height": 720
        },
        "targets": [
          {
            "id": "menu",
            "rect": {
              "x": 40,
              "y": 40,
              "width": 200,
              "height": 120
            },
            "autoRepeat": false,
            "role": "default"
          },
          {
            "id": "next",
            "rect": {
              "x": 1040,
              "y": 40,
              "width": 200,
              "height": 120
            },
            "autoRepeat": false,
            "role": "default"
          },
          {
            "id": "rest",
            "rect": {
              "x": 540,
              "y": 600,
              "width": 200,
              "height": 80
            },
            "autoRepeat": false,
            "role": "rest-area"
          }
        ]
      },
      "profile": {
        "dwellTime": 1000
      },
      "effectiveProfiles": [
        {
          "user": "head-tremor",
          "effectiveProfile": {
            "mode": "head + dwell",
            "startCameraOnLoad": false,
            "switchGesture": "jaw open",
            "switchBinding": " ",
            "headGain": 1,
            "headDeadZone": 0.5,
            "smoothingStrength": 0.5,
            "dwellTime": 1000,
            "graceTime": 150,
            "postSelectionPause": 500,
            "autoRepeatInterval": 1000,
            "scanInterval": 1200,
            "scanLoopsBeforePause": 3,
            "switchAcceptanceTime": 0,
            "gestureAcceptanceTime": 300,
            "gestureThreshold": 0.5,
            "gestureReleaseThreshold": 0.3,
            "cancelByHold": true,
            "cancelHoldTime": 2000,
            "noFaceTimeout": 10000,
            "inputTimeout": 2000,
            "calibrationRangeLeft": 15,
            "calibrationRangeRight": 15,
            "calibrationRangeUp": 15,
            "calibrationRangeDown": 15,
            "calibrationStillnessThreshold": 2,
            "calibrationStillnessTime": 1500,
            "calibrationStepTimeout": 6000,
            "targetSize": 96,
            "targetSpacing": 16
          }
        }
      ]
    },
    "b": {
      "label": "dwell 1400",
      "layout": {
        "screen": {
          "width": 1280,
          "height": 720
        },
        "targets": [
          {
            "id": "menu",
            "rect": {
              "x": 40,
              "y": 40,
              "width": 200,
              "height": 120
            },
            "autoRepeat": false,
            "role": "default"
          },
          {
            "id": "next",
            "rect": {
              "x": 1040,
              "y": 40,
              "width": 200,
              "height": 120
            },
            "autoRepeat": false,
            "role": "default"
          },
          {
            "id": "rest",
            "rect": {
              "x": 540,
              "y": 600,
              "width": 200,
              "height": 80
            },
            "autoRepeat": false,
            "role": "rest-area"
          }
        ]
      },
      "profile": {
        "dwellTime": 1400
      },
      "effectiveProfiles": [
        {
          "user": "head-tremor",
          "effectiveProfile": {
            "mode": "head + dwell",
            "startCameraOnLoad": false,
            "switchGesture": "jaw open",
            "switchBinding": " ",
            "headGain": 1,
            "headDeadZone": 0.5,
            "smoothingStrength": 0.5,
            "dwellTime": 1400,
            "graceTime": 150,
            "postSelectionPause": 500,
            "autoRepeatInterval": 1000,
            "scanInterval": 1200,
            "scanLoopsBeforePause": 3,
            "switchAcceptanceTime": 0,
            "gestureAcceptanceTime": 300,
            "gestureThreshold": 0.5,
            "gestureReleaseThreshold": 0.3,
            "cancelByHold": true,
            "cancelHoldTime": 2000,
            "noFaceTimeout": 10000,
            "inputTimeout": 2000,
            "calibrationRangeLeft": 15,
            "calibrationRangeRight": 15,
            "calibrationRangeUp": 15,
            "calibrationRangeDown": 15,
            "calibrationStillnessThreshold": 2,
            "calibrationStillnessTime": 1500,
            "calibrationStepTimeout": 6000,
            "targetSize": 96,
            "targetSpacing": 16
          }
        }
      ]
    }
  },
  "metrics": {
    "accidental": {
      "aWins": 0,
      "bWins": 0,
      "ties": 2,
      "verdict": "tie"
    },
    "misses": {
      "aWins": 0,
      "bWins": 0,
      "ties": 2,
      "verdict": "tie"
    },
    "timeToSelect": {
      "aWins": 2,
      "bWins": 0,
      "ties": 0,
      "verdict": "a did better",
      "pairedTrials": 2
    }
  },
  "pairs": [
    {
      "user": "head-tremor",
      "trial": 0,
      "a": {
        "accidental": 0,
        "misses": 0,
        "medianTimeMs": 3233.333333333334
      },
      "b": {
        "accidental": 0,
        "misses": 0,
        "medianTimeMs": 3633.333333333332
      }
    },
    {
      "user": "head-tremor",
      "trial": 1,
      "a": {
        "accidental": 0,
        "misses": 0,
        "medianTimeMs": 3166.666666666668
      },
      "b": {
        "accidental": 0,
        "misses": 0,
        "medianTimeMs": 3566.666666666668
      }
    }
  ],
  "statement": "These counts are not a test of statistical significance.",
  "warnings": [
    "NO_CANCEL_TARGET: the layout has no cancel-role target. Accessibility rule: head-pointer layouts place a cancel target."
  ],
  "notes": [],
  "disclaimer": "Simulated users are models from published group averages, not real people. Use these results to compare layouts and settings."
}
```

### Errors

A rejected request returns `isError: true`, one text item with the error as compact JSON, and the same object as `structuredContent`:

`{ code, parameter, message, allowed? }`

`parameter` is a path from the request root, for example `users[2].overrides.throughputBitsPerS` or `layout.targets["menu"].rect.width`. In `compare`, side-specific paths start with `a.` or `b.`. `allowed` lists the allowed values, or is `{ min, max }`, where that applies.

Example: the `simulate` request above with `"mode": "scan"` returns:

<!-- example: error-output -->
```json
{
  "code": "UNSUPPORTED_MODE",
  "parameter": "mode",
  "message": "Input mode \"scan\" is not supported. Supported modes: head + dwell.",
  "allowed": [
    "head + dwell"
  ]
}
```

Codes: `UNKNOWN_PRESET`, `OUT_OF_RANGE`, `CAP_EXCEEDED`, `NOT_ALLOWED_VALUE`, `UNSUPPORTED_MODE`, `NO_SELECTABLE_TARGETS`, `UNKNOWN_TARGET`, `ADJACENT_REPEAT`, `INVALID_LAYOUT`, `LAYOUT_MISMATCH`, `UNKNOWN_PARAMETER`, `INTERNAL_ERROR`. `INTERNAL_ERROR` means the simulation threw. It has an empty `parameter` and no `allowed`, and the stack goes to stderr.

## Supported modes

Only `head + dwell` is supported in this release. Scan mode is deferred: the input schema accepts `scan`, and validation rejects it with `UNSUPPORTED_MODE` (the error above). `head + gesture`, `gesture scan` and `mouse` are rejected the same way.

## Limits

- At most 12 users, 50 trials per user, 100 targets and 500 task entries.
- The model is open loop: the simulated head does not react to what the pointer does, except that the next task entry starts when the previous one ends. Real tremor is less regular than the sine used here, there are no tracking dropouts, and the camera adapter's maths is not modelled.
- Results depend on frame rate. At 15 fps the smoothed pointer arrives later than at 60 fps, and time-to-select includes that delay.
- Counts from a few trials are noisy. Use more trials, and more than one seed, before drawing conclusions.

The sources, formulas, chosen values and the full list of limits are in [METHODOLOGY.md](METHODOLOGY.md).

## Where the examples come from

The `simulate` and `compare` results and the error are the unedited `structuredContent` of a real run of the built tool handlers (seed 1, 2 trials, `head-tremor`, the 1280 × 720 layout above), pretty-printed. The `list_users` example is a cut-down copy of the real output, as marked. `test/readme.test.ts` checks that the `list_users`, `simulate` and `compare` examples match the output schemas in `src/tool-schemas.ts`. In this small run the user makes no accidental selections, so `accidentalSelections` and `suggestions` are empty.

## Disclaimer

Simulated users are models from published group averages, not real people. Use these results to compare layouts and settings.

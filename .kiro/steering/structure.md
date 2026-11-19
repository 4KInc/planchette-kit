---
inclusion: always
---

# Structure

```
/.kiro/
  steering/        product, tech, structure, accessibility
  specs/           one folder per spec (requirements, design, tasks)
  hooks/           agent hooks
  agents/          custom agents (layout designer, accessibility reviewer)
/index.html        entry page for the skeleton demo (loads skeleton/demo/main.ts)
/board/index.html  entry page for App A (loads apps/board/src/main.ts)
/game/index.html   entry page for App B (loads apps/game/src/main.ts)
/skeleton/         the template package
  src/engine/      deterministic logic: dwell, scanning, gesture, smoothing, calibration
  src/adapters/    camera (MediaPipe head + face gesture), keyboard/switch, mouse, gamepad
  src/ui/          optional helpers: dwell ring, scan highlight, calibration screen
  src/index.ts     the public API
  demo/main.ts     skeleton demo script (entry loaded by /index.html)
  test/            unit and property tests
  examples/        the 15-line integration example
/apps/board/       App A: communication board
  src/main.ts      board app script (entry loaded by /board/index.html)
/apps/game/        App B: haunted target game
  src/main.ts      game app script (entry loaded by /game/index.html)
/tools/dwell-sim-mcp/  MCP server for simulated users
/power/            the "Make this app hands-free" Kiro power (check the current power
                   format on kiro.dev before building it)
/test-media/       short MP4 face clips (own recordings only), converted to .y4m before e2e tests
/docs/             kiro-journal.md, design notes, screenshots
THIRD_PARTY.md     every dependency and its licence
```

## Conventions
- Apps and tools import the skeleton only through its public API
  (`skeleton/src/index.ts`), never from internal paths. If something is missing, add
  it to the API.
- `/tools/dwell-sim-mcp` drives the skeleton's real engine through the public API.
  It never reimplements the engine; otherwise it would test a copy, not the engine.
- Engine files export state machines with the shape `step(state, input, now)`.
- File names in kebab-case. One main export per file.
- Test files sit in `test/` next to `src/`, named `<thing>.test.ts`; property tests
  `<thing>.props.test.ts`.
- User-facing text lives in one place per app so it can be reviewed and translated.

## Deferred to later specs
The following are intentionally not defined here and will each have their own spec:
- The dwell simulator's MCP tool interface (inputs, outputs, movement model parameters).
- Word prediction in the communication board (source, trigger, strip behaviour).
- App B game design (round structure, scoring, win/lose conditions).
- The Kiro power format (check kiro.dev for the current format before building `/power`).

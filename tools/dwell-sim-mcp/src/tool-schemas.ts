/**
 * zod schemas of the three MCP tools (design section 11).
 *
 * Input shapes describe structure and types only. Ranges and caps are in the `.describe()` text;
 * `validate-request.ts` (Task 14.2) checks them and returns the stable error codes. Defaults are
 * applied here (seed 1, fps 30, analysis window 10 s, 10 trials, mode `head + dwell`), not in
 * `simulate` or `compare`.
 *
 * The SDK's `registerTool` (1.32.2, `server/mcp.d.ts`) takes `inputSchema` / `outputSchema` as a zod raw
 * shape (`Record<string, ZodType>`) or a zod object schema. The `*Input` and `*Output` constants are raw
 * shapes, as in the design; the `*Schema` constants are the same shapes wrapped in `z.object`.
 *
 * The `outputSchema` is checked by the SDK for successful results only. It is skipped for `isError` results,
 * so an error result needs no output schema.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

const RectSchema = z.object({
  x: z.number().describe("Left edge in CSS pixels."),
  y: z.number().describe("Top edge in CSS pixels."),
  width: z.number().describe("Width in CSS pixels. Must be finite and greater than 0."),
  height: z.number().describe("Height in CSS pixels. Must be finite and greater than 0."),
});

export const TARGET_ROLES = ["default", "cancel", "undo", "rest-area"] as const;

const TargetSchema = z.object({
  id: z.string().describe("Unique, non-empty target id."),
  rect: RectSchema.describe("Target rectangle in CSS pixels."),
  autoRepeat: z
    .boolean()
    .optional()
    .describe("True if the target repeats while held; allows the same target twice in a row in the task. Default false."),
  role: z
    .enum(TARGET_ROLES)
    .optional()
    .describe("Target role: default, cancel, undo or rest-area. Default `default`. Rest areas are not selectable."),
});

export const LayoutSchema = z.object({
  screen: z
    .object({
      width: z.number().describe("Screen width in CSS pixels. Must be finite and greater than 0."),
      height: z.number().describe("Screen height in CSS pixels. Must be finite and greater than 0."),
    })
    .describe("Screen size in CSS pixels."),
  targets: z.array(TargetSchema).describe("The targets of the layout. At most 100; at least one must be selectable (not rest-area)."),
});

const CustomOverridesSchema = z
  .object({
    throughputBitsPerS: z.number().optional().describe("Head pointing throughput in bits/s. Range 0.3 to 4."),
    tremorFrequencyHz: z.number().optional().describe("Tremor frequency in Hz. Range 0 to 15."),
    tremorPeakToPeakDeg: z.number().optional().describe("Tremor peak-to-peak amplitude in degrees. Range 0 to 5."),
    tremorAxis: z.enum(["yaw", "pitch"]).optional().describe("Axis the tremor acts on: yaw or pitch."),
    headRangeDeg: z
      .object({
        left: z.number().optional().describe("Head range to the left in degrees. Range 3 to 60."),
        right: z.number().optional().describe("Head range to the right in degrees. Range 3 to 60."),
        up: z.number().optional().describe("Head range upward in degrees. Range 3 to 60."),
        down: z.number().optional().describe("Head range downward in degrees. Range 3 to 60."),
      })
      .optional()
      .describe("Head range per direction in degrees. Give any subset of directions."),
    reactionTimeMs: z.number().optional().describe("Reaction time in ms. Range 150 to 1500."),
    readingPauseChancePct: z.number().optional().describe("Chance in percent of a reading pause on a crossed target. Range 0 to 100."),
    readingPauseLengthMs: z
      .object({
        min: z.number().describe("Shortest reading pause in ms. Range 0 to 3000; not above max."),
        max: z.number().describe("Longest reading pause in ms. Range 0 to 3000; not below min."),
      })
      .optional()
      .describe("Reading pause length range in ms."),
    scatterCapDeg: z.number().optional().describe("Cap on the end-point scatter in degrees. Range 0.1 to 3."),
    trackingNoiseDeg: z.number().optional().describe("Tracking noise, peak per axis, in degrees. Range 0 to 2."),
  })
  .strict();

const CustomUserSchema = z.object({
  name: z.string().describe("Name of the custom user, used in the results."),
  base: z.string().optional().describe("Preset to start from. Default `steady`."),
  overrides: CustomOverridesSchema.describe("Parameters to override on the base preset. Unknown keys are rejected."),
});

const TaskSchema = z
  .union([
    z.array(z.string()).describe("Explicit list of target ids, in order. At most 500 entries."),
    z.object({
      eachTarget: z
        .number()
        .describe("Each selectable target this many times, shuffled per round. Integer 1 to 100; n times the selectable targets at most 500."),
    }),
  ])
  .describe("The task: an explicit list of target ids, or { eachTarget: n }.");

/** Every mode name is accepted so that validation, not zod, returns UNSUPPORTED_MODE. */
export const MODES = ["head + dwell", "scan", "head + gesture", "gesture scan", "mouse"] as const;
const ModeSchema = z.enum(MODES);

const ProfileSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe("Partial skeleton profile, for example { dwellTime: 1000 }. The skeleton clamps it; unknown keys are ignored.");

const UsersSchema = z
  .array(z.union([z.string(), CustomUserSchema]))
  .describe("Simulated users, in order: preset names or custom users. At most 12. Call list_users for the presets.");

const modeField = ModeSchema.default("head + dwell").describe(
  "Input mode. Default `head + dwell`. Only `head + dwell` is supported in this release.",
);
const trialsField = z.number().default(10).describe("Trials per user. Integer 1 to 50. Default 10.");
const fpsField = z.number().default(30).describe("Camera frame rate in frames per second. One of 15, 30, 60. Default 30.");
const windowField = z.number().default(10).describe("Analysis window in seconds. Range 2 to 120. Default 10.");
const seedField = z.number().default(1).describe("Random seed. Integer from -2147483648 to 2147483647. Default 1.");

export const SimulateInput = {
  layout: LayoutSchema.describe("The layout to test: screen size and targets."),
  profile: ProfileSchema,
  mode: modeField,
  users: UsersSchema,
  task: TaskSchema,
  trialsPerUser: trialsField,
  fps: fpsField,
  analysisWindowS: windowField,
  seed: seedField,
};

export const CompareInput = {
  a: z
    .object({
      layout: LayoutSchema.describe("Layout of configuration A."),
      profile: ProfileSchema,
      label: z.string().optional().describe("Optional label of configuration A, echoed in the result."),
    })
    .describe("Configuration A."),
  b: z
    .object({
      layout: LayoutSchema.optional().describe("Layout of configuration B. Defaults to A's layout. Must have the same target ids as A."),
      profile: ProfileSchema,
      label: z.string().optional().describe("Optional label of configuration B, echoed in the result."),
    })
    .describe("Configuration B."),
  mode: modeField,
  users: UsersSchema,
  task: TaskSchema,
  trialsPerUser: trialsField,
  fps: fpsField,
  analysisWindowS: windowField,
  seed: seedField,
};

/** `list_users` takes no input. */
export const ListUsersInput = {};

export const SimulateInputSchema = z.object(SimulateInput);
export const CompareInputSchema = z.object(CompareInput);
export const ListUsersInputSchema = z.object(ListUsersInput);

/** A request as parsed, with defaults applied. Users and layout still need validation and resolution (Task 14.2). */
export type SimulateToolInput = z.output<typeof SimulateInputSchema>;
export type CompareToolInput = z.output<typeof CompareInputSchema>;

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

/** The seven accidental causes. `start` is not one of them: start-of-session events are their own category. */
export const ACCIDENTAL_CAUSE_NAMES = [
  "reading-pause",
  "pass-over",
  "tremor-at-edge",
  "repeat",
  "waiting",
  "early-on-intended-target",
  "other",
] as const;
export const ACTIVITY_NAMES = ["waiting", "moving", "reading pause", "holding on the aim point"] as const;
export const SUGGESTION_METRICS = ["reading-pause share", "tremor-at-edge share", "unreachable", "screen-centre-hit"] as const;

const CauseEnum = z.enum(ACCIDENTAL_CAUSE_NAMES);
const ActivityEnum = z.enum(ACTIVITY_NAMES);

const nullableNumber = (text: string) => z.number().nullable().describe(text);

const CausesSchema = z
  .object({
    "reading-pause": z.number().describe("Accidental selections caused by a reading pause."),
    "pass-over": z.number().describe("Accidental selections while passing over the target."),
    "tremor-at-edge": z.number().describe("Accidental selections from tremor at the target edge."),
    repeat: z.number().describe("Accidental selections from a repeat."),
    waiting: z.number().describe("Accidental selections while waiting."),
    "early-on-intended-target": z.number().describe("Selections of the intended target before the user meant to select it."),
    other: z.number().describe("Accidental selections with another cause."),
  })
  .describe("Accidental selections by cause. All seven causes are always present.");

const ActivitiesSchema = z
  .object({
    waiting: z.number().describe("Accidental selections while waiting."),
    moving: z.number().describe("Accidental selections while moving."),
    "reading pause": z.number().describe("Accidental selections during a reading pause."),
    "holding on the aim point": z.number().describe("Accidental selections while holding on the aim point."),
  })
  .describe("Accidental selections by user activity. All four labels are always present.");

const TimeToSelectSchema = z
  .object({
    median: nullableNumber("Median time to select in ms (nearest rank); null with no data."),
    p90: nullableNumber("90th percentile time to select in ms (nearest rank); null with no data."),
  })
  .describe("Time from the start of the move to the intended selection.");

const metricFields = {
  intended: z.number().describe("Intended selections."),
  accidental: z.number().describe("Accidental selections. Start-of-session events are not included."),
  startCount: z.number().describe("Start-of-session events, counted separately from accidental selections."),
  accidentalPer100Intended: nullableNumber("Accidental selections per 100 intended, one decimal; null when there are no intended selections."),
  misses: z.number().describe("Task entries not selected before their deadline."),
  timeToSelectMs: TimeToSelectSchema,
  causes: CausesSchema,
  activities: ActivitiesSchema,
};

const TargetMetricsSchema = z.object({
  targetId: z.string().nullable().describe("Target id; null for events without a target."),
  ...metricFields,
});

const StartOfSessionSchema = z
  .object({
    count: z.number().describe("Start-of-session events of this user."),
    byTarget: z
      .array(
        z.object({
          targetId: z.string().nullable().describe("Target id; null for a cancel without a target."),
          count: z.number().describe("Start-of-session events on this target."),
        }),
      )
      .describe("Counts by target, sorted by id with null last."),
  })
  .describe("Start-of-session events. They are not accidental selections.");

const UserMetricsSchema = z.object({
  name: z.string().describe("User name."),
  trials: z.number().describe("Number of trials run."),
  ...metricFields,
  startOfSession: StartOfSessionSchema,
  perTarget: z.array(TargetMetricsSchema).describe("One row per selectable target, sorted by id with the null bucket last."),
});

const UserParamsSchema = z
  .object({
    throughputBitsPerS: z.number().describe("Head pointing throughput in bits/s."),
    tremorFrequencyHz: z.number().describe("Tremor frequency in Hz."),
    tremorPeakToPeakDeg: z.number().describe("Tremor peak-to-peak amplitude in degrees."),
    tremorAxis: z.enum(["yaw", "pitch"]).describe("Axis the tremor acts on."),
    tremorDriftFraction: z.number().describe("Fraction of the tremor amplitude that drifts."),
    headRangeDeg: z
      .object({
        left: z.number().describe("Head range to the left in degrees."),
        right: z.number().describe("Head range to the right in degrees."),
        up: z.number().describe("Head range upward in degrees."),
        down: z.number().describe("Head range downward in degrees."),
      })
      .describe("Head range per direction in degrees."),
    reactionTimeMs: z.number().describe("Reaction time in ms."),
    readingPauseChancePct: z.number().describe("Chance in percent of a reading pause on a crossed target."),
    readingPauseLengthMs: z
      .object({
        min: z.number().describe("Shortest reading pause in ms."),
        max: z.number().describe("Longest reading pause in ms."),
      })
      .describe("Reading pause length range in ms."),
    trackingNoiseDeg: z.number().describe("Tracking noise, peak per axis, in degrees."),
    scatterCapDeg: z.number().describe("Cap on the end-point scatter in degrees."),
    scanReactionTimeMs: z.number().describe("Scan reaction time in ms."),
    scanLatePressChancePct: z.number().describe("Chance in percent of a late scan press."),
    scanPressDurationMs: z.number().describe("Scan press duration in ms."),
  })
  .describe("All parameter values of the user.");

const EffectiveProfileSchema = z
  .record(z.string(), z.unknown())
  .describe("The skeleton profile the trials ran with, after the calibration-range fill and clamping.");

const SuggestionSchema = z.object({
  targetId: z.string().describe("Target the suggestion is about."),
  metric: z.enum(SUGGESTION_METRICS).describe("Bare name of the rule that produced the suggestion."),
  value: nullableNumber("Share rounded to two decimals for the two share metrics; null for unreachable and screen-centre-hit."),
  users: z.array(z.string()).describe("Users the suggestion applies to, in request order. May be empty."),
  text: z.string().describe("The suggestion text."),
  followUp: z
    .object({
      factor: z.number().describe("Multiple of the target size with no accidental selections and no misses."),
      overlaps: z.array(z.string()).describe("Ids of the targets that size overlaps."),
    })
    .optional()
    .describe("Result of the follow-up run, for tremor-at-edge suggestions."),
});

const disclaimerField = z.string().describe("Disclaimer: simulated users are models, not real people.");
const warningsField = z.array(z.string()).describe("Warnings, each starting with its code and a colon.");
const notesField = z.array(z.string()).describe("Notes, each starting with its code and a colon.");

export const SimulateOutput = {
  seed: z.number().describe("The seed used."),
  parameters: z
    .object({
      layout: LayoutSchema.describe("The request's layout as given."),
      mode: ModeSchema.describe("Input mode."),
      fps: z.number().describe("Frame rate."),
      analysisWindowS: z.number().describe("Analysis window in seconds."),
      trialsPerUser: z.number().describe("Trials per user."),
      task: TaskSchema,
      profile: z.record(z.string(), z.unknown()).describe("The request profile as given."),
      users: z
        .array(
          z.object({
            name: z.string().describe("User name."),
            params: UserParamsSchema,
            effectiveProfile: EffectiveProfileSchema,
          }),
        )
        .describe("The resolved users."),
    })
    .describe("The full request parameters after defaults, so the run can be repeated."),
  users: z.array(UserMetricsSchema).describe("Metrics per user, in request order."),
  accidentalSelections: z
    .array(
      z.object({
        user: z.string().describe("User name."),
        trial: z.number().describe("Trial index."),
        targetId: z.string().nullable().describe("Target id; null for a cancel without a target."),
        timeMs: z.number().describe("Time of the event in ms of simulated time."),
        activity: ActivityEnum.describe("What the user was doing."),
        cause: CauseEnum.describe("Cause of the accidental selection."),
      }),
    )
    .describe("Every accidental selection."),
  suggestions: z.array(SuggestionSchema).describe("Suggestions, ordered as in the design."),
  warnings: warningsField,
  notes: notesField,
  disclaimer: disclaimerField,
};

const VerdictText = z.enum(["a did better", "b did better", "tie"]);
const verdictFields = {
  aWins: z.number().describe("Pairs won by A."),
  bWins: z.number().describe("Pairs won by B."),
  ties: z.number().describe("Tied pairs."),
  verdict: VerdictText.describe("Pooled verdict; lower is better."),
};
const PairSideSchema = z.object({
  accidental: z.number().describe("Accidental selections in the trial."),
  misses: z.number().describe("Misses in the trial."),
  medianTimeMs: nullableNumber("Median time to select over the entries selected on both sides; null when none."),
});
const SideParametersSchema = z.object({
  label: z.string().optional().describe("The label from the request, if any."),
  layout: LayoutSchema.describe("The layout of this side."),
  profile: z.record(z.string(), z.unknown()).describe("The profile as given."),
  effectiveProfiles: z
    .array(
      z.object({
        user: z.string().describe("User name."),
        effectiveProfile: EffectiveProfileSchema,
      }),
    )
    .describe("The effective profile of each user."),
});

export const CompareOutput = {
  seed: z.number().describe("The seed used."),
  parameters: z
    .object({
      shared: z
        .object({
          mode: ModeSchema.describe("Input mode."),
          fps: z.number().describe("Frame rate."),
          analysisWindowS: z.number().describe("Analysis window in seconds."),
          trialsPerUser: z.number().describe("Trials per user."),
          task: TaskSchema,
          users: z
            .array(z.object({ name: z.string().describe("User name."), params: UserParamsSchema }))
            .describe("The resolved users."),
        })
        .describe("Parameters shared by both configurations."),
      a: SideParametersSchema.describe("Configuration A."),
      b: SideParametersSchema.describe("Configuration B."),
    })
    .describe("The parameters of the comparison."),
  metrics: z
    .object({
      accidental: z.object(verdictFields).describe("Accidental selections per pair."),
      misses: z.object(verdictFields).describe("Misses per pair."),
      timeToSelect: z
        .object({ ...verdictFields, pairedTrials: z.number().describe("Pairs with a time on both sides.") })
        .describe("Median time to select per pair."),
    })
    .describe("One pooled verdict per metric."),
  pairs: z
    .array(
      z.object({
        user: z.string().describe("User name."),
        trial: z.number().describe("Trial index."),
        a: PairSideSchema.describe("Side A of the pair."),
        b: PairSideSchema.describe("Side B of the pair."),
      }),
    )
    .describe("One pair per user and trial."),
  statement: z.string().describe("Statement that the counts are not a significance test."),
  warnings: warningsField,
  notes: notesField,
  disclaimer: disclaimerField,
};

const ListedSourceSchema = z
  .union([
    z.string(),
    z.object({
      row: z.string().describe("Label of the Figures table row."),
      ref: z.number().describe("Reference number."),
      citation: z.string().describe("Reference text."),
      note: z.string().optional().describe("Optional note on how the value was derived."),
    }),
  ])
  .describe("A citation (row, reference number and text) or a string such as `chosen: <reason>`.");

export const ListUsersOutput = {
  users: z
    .array(
      z.object({
        name: z.string().describe("Preset name."),
        description: z.string().describe("What the preset models."),
        parameters: z
          .record(
            z.string(),
            z.object({
              value: z.unknown().describe("The parameter value."),
              source: ListedSourceSchema,
            }),
          )
          .describe("Parameter values with their sources."),
      }),
    )
    .describe("The simulated user presets."),
  customRanges: z
    .record(
      z.string(),
      z.object({
        min: z.number().describe("Lowest allowed value."),
        max: z.number().describe("Highest allowed value."),
        unit: z.string().describe("Unit of the value."),
      }),
    )
    .describe("Allowed ranges of the customisable parameters."),
  disclaimer: disclaimerField,
};

export const SimulateOutputSchema = z.object(SimulateOutput);
export const CompareOutputSchema = z.object(CompareOutput);
export const ListUsersOutputSchema = z.object(ListUsersOutput);

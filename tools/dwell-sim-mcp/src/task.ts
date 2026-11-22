/**
 * Task expansion (design section 4.8). Turns a task spec into the explicit list of target ids.
 * An adjacent repeat on a target without autoRepeat is reported as ADJACENT_REPEAT (Req 4 AC 26, 28).
 */
import { Purpose, stream, u01 } from "./rng.js";
import type { Layout, TaskSpec } from "./types.js";

/** `index` is the zero-based position of the second entry of the offending pair. */
export type TaskError = { code: "ADJACENT_REPEAT"; index: number; targetId: string };

export type TaskResult = { ok: true; ids: string[] } | { ok: false; error: TaskError };

export function expandTask(layout: Layout, spec: TaskSpec, seed: number): TaskResult {
  if (Array.isArray(spec)) {
    const list = spec as readonly string[];
    for (let i = 1; i < list.length; i++) {
      if (list[i] === list[i - 1]) {
        // An id unknown to the layout counts as having no autoRepeat.
        const t = layout.targets.find((x) => x.id === list[i]);
        if (!t || !t.autoRepeat) return { ok: false, error: { code: "ADJACENT_REPEAT", index: i, targetId: list[i] } };
      }
    }
    return { ok: true, ids: [...list] };
  }
  const n = (spec as { eachTarget: number }).eachTarget;

  const selectable = layout.targets.filter((t) => t.role !== "rest-area");
  const ids = selectable.map((t) => t.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (ids.length === 0) return { ok: true, ids: [] };

  if (ids.length === 1) {
    // autoRepeat: n unshuffled copies. Without autoRepeat and n > 1 the repeat at position 1 is an error.
    const only = selectable[0];
    if (n > 1 && !only.autoRepeat) {
      return { ok: false, error: { code: "ADJACENT_REPEAT", index: 1, targetId: ids[0] } };
    }
    return { ok: true, ids: Array.from({ length: n }, () => ids[0]) };
  }

  const taskOrder = stream(seed, 0, 0, Purpose.TaskOrder);
  const out: string[] = [];
  for (let r = 0; r < n; r++) {
    const round = [...ids];
    for (let i = round.length - 1; i >= 1; i--) {
      const j = Math.floor(u01(taskOrder, r, i) * (i + 1));
      const tmp = round[i];
      round[i] = round[j];
      round[j] = tmp;
    }
    // Repair at the round boundary; draws nothing.
    if (r >= 1 && round[0] === out[out.length - 1]) {
      const tmp = round[0];
      round[0] = round[1];
      round[1] = tmp;
    }
    out.push(...round);
  }
  return { ok: true, ids: out };
}

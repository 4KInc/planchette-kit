/**
 * settings-gate.ts — the "no Target selection while Settings is open" rule, for the part of it
 * a flag cannot cover (design.md "Settings UI", "Targets under the dialog").
 *
 * The skeleton does not emit `select` inside the pointer event. The mouse adapter queues the
 * press and release and the engine reads them on the next animation frame, and a click on the
 * Close button (or Escape or Calibrate) closes the dialog before that frame. So the `select`
 * for a press that happened while the dialog was open can arrive after `close`, and would act
 * on whatever target lies under the Close button. `select.detail.now` is the press's own
 * timestamp (`PointerEvent.timeStamp`, the `performance.now()` clock), so a select whose `now`
 * is not later than the moment the dialog closed belongs to the open dialog and is ignored.
 */
export interface SettingsGate {
  /** True for a `select` stamped at or before the last close of the dialog. */
  isStale(selectNow: number): boolean;
  destroy(): void;
}

export function createSettingsGate(doc: Document): SettingsGate {
  const dialog = doc.getElementById('settings');
  const clock = (): number => doc.defaultView?.performance.now() ?? Number.POSITIVE_INFINITY;
  let closedAt = Number.NEGATIVE_INFINITY;
  const onClose = (): void => {
    closedAt = clock();
  };
  dialog?.addEventListener('close', onClose);
  return {
    isStale: (selectNow) => selectNow <= closedAt,
    destroy: () => dialog?.removeEventListener('close', onClose),
  };
}

/**
 * settings-gate.ts: the "no Target selection while Settings is open" rule. The logic moved to the
 * skeleton's `@planchette/skeleton/ui` (`createSettingsGate`); this re-export keeps the Board's imports.
 */
export { createSettingsGate, type SettingsGate } from '@planchette/skeleton/ui';

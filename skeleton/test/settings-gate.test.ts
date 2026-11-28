// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createSettingsGate } from '../src/ui/settings-gate.js';
afterEach(() => {
  document.body.innerHTML = '';
});
describe('createSettingsGate', () => {
  it('treats a select stamped at or before the last close as stale', () => {
    document.body.innerHTML = '<dialog id="settings"></dialog>';
    const gate = createSettingsGate(document);
    expect(gate.isStale(0)).toBe(false);
    const before = performance.now(); // read just before the close, so it is not later than the gate's own reading
    document.getElementById('settings')!.dispatchEvent(new Event('close'));
    expect(gate.isStale(before)).toBe(true);
    expect(gate.isStale(before - 5)).toBe(true);
    expect(gate.isStale(performance.now() + 1000)).toBe(false);
  });
  it('stops listening after destroy', () => {
    document.body.innerHTML = '<dialog id="settings"></dialog>';
    const gate = createSettingsGate(document);
    gate.destroy();
    document.getElementById('settings')!.dispatchEvent(new Event('close'));
    expect(gate.isStale(0)).toBe(false);
  });
  it('is never stale when the page has no dialog', () => {
    const gate = createSettingsGate(document);
    expect(gate.isStale(0)).toBe(false);
  });
});

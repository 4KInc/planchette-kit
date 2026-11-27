import { describe, expect, it } from 'vitest';
import { messageBarLayout, renderedCellSize } from '../src/board-scale.js';

describe('renderedCellSize (80 px Message bar)', () => {
  it('is 96 at 1366x768 with the defaults', () => {
    expect(renderedCellSize(96, 16, 1, { width: 1366, height: 768 })).toBe(96);
  });
  it('is 148 at 1920x1080 with the defaults', () => {
    expect(renderedCellSize(96, 16, 1, { width: 1920, height: 1080 })).toBe(148);
  });
  it('is 136 at 1920x1080 with a two-row strip', () => {
    expect(renderedCellSize(96, 16, 2, { width: 1920, height: 1080 })).toBe(136);
  });
  it('never goes below a Profile size of 200', () => {
    expect(renderedCellSize(200, 16, 1, { width: 1920, height: 1080 })).toBe(200);
  });
  it('gives the Profile size for a 100x100 viewport', () => {
    expect(renderedCellSize(96, 16, 1, { width: 100, height: 100 })).toBe(96);
  });
  it('gives 96 for a Profile size of 64 at 1366x768', () => {
    expect(renderedCellSize(64, 16, 1, { width: 1366, height: 768 })).toBe(96);
  });
  it('is whole, and fits the 1920x1080 left column at s but not at s + 1 (80 px bar)', () => {
    const s = renderedCellSize(96, 16, 1, { width: 1920, height: 1080 });
    expect(Number.isInteger(s)).toBe(true);
    const leftColumn = (cell: number) => 16 + 80 + 6 * cell + 6 * 16;
    expect(leftColumn(s)).toBeLessThanOrEqual(1080);
    expect(leftColumn(s + 1)).toBeGreaterThan(1080);
  });
  it('is limited by the width at 1366 wide, however tall the viewport', () => {
    expect(renderedCellSize(96, 16, 1, { width: 1366, height: 4000 })).toBe(96);
  });
  it('falls back to the Profile size for a non-finite viewport', () => {
    expect(renderedCellSize(96, 16, 1, { width: NaN, height: 1080 })).toBe(96);
  });
});

describe('messageBarLayout', () => {
  const vp = (width: number, height: number) => ({ width, height });
  it('gives a one-line bar and 96 at 1366x768', () => {
    expect(messageBarLayout(96, 16, 1, vp(1366, 768))).toEqual({ lines: 1, barHeight: 80, cellSize: 96, pageMinHeight: 768 });
  });
  it('gives a two-line bar and 139 at 1920x1080', () => {
    expect(messageBarLayout(96, 16, 1, vp(1920, 1080))).toEqual({ lines: 2, barHeight: 131, cellSize: 139, pageMinHeight: 1077 });
  });
  it('gives a two-line bar and 109 at 1600x900', () => {
    expect(messageBarLayout(96, 16, 1, vp(1600, 900))).toEqual({ lines: 2, barHeight: 131, cellSize: 109, pageMinHeight: 897 });
  });
  it('gives a one-line bar and 117 at 1599x899', () => {
    const r = messageBarLayout(96, 16, 1, vp(1599, 899));
    expect(r.lines).toBe(1);
    expect(r.barHeight).toBe(80);
    expect(r.cellSize).toBe(117);
  });
  it('gives two lines and 136 at 1920x1080 with a two-row strip', () => {
    const r = messageBarLayout(96, 16, 2, vp(1920, 1080));
    expect(r.lines).toBe(2);
    expect(r.cellSize).toBe(136);
  });
  it('gives a one-line bar and 200 for a Profile size of 200 at 1920x1080', () => {
    const r = messageBarLayout(200, 16, 1, vp(1920, 1080));
    expect(r.lines).toBe(1);
    expect(r.barHeight).toBe(80);
    expect(r.cellSize).toBe(200);
  });
  it('gives the one-line bar and the Profile size for a 100x100 viewport', () => {
    const r = messageBarLayout(96, 16, 1, vp(100, 100));
    expect(r.lines).toBe(1);
    expect(r.barHeight).toBe(80);
    expect(r.cellSize).toBe(96);
  });
  it('gives the one-line bar and the Profile size for a non-finite viewport', () => {
    const r = messageBarLayout(96, 16, 1, vp(NaN, NaN));
    expect(r.lines).toBe(1);
    expect(r.cellSize).toBe(96);
  });
});

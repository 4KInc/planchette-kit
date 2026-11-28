/** An in-memory `Storage` stand-in for tests. */
export class MemoryStorage {
  readonly data = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes += 1;
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}
/** A storage whose every call throws. */
export const throwingStorage = {
  getItem(): string | null {
    throw new Error('blocked');
  },
  setItem(): void {
    throw new Error('quota');
  },
  removeItem(): void {
    throw new Error('blocked');
  },
};

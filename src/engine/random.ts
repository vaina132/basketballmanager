/** Versioned xorshift32 stream. Zero seeds are mapped to a documented nonzero state. */
export function normalizeSeed(seed: number): number {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error('The match seed must be an unsigned 32-bit integer.');
  }
  return seed === 0 ? 0x6d2b79f5 : seed;
}

export function nextRandom(state: number): { state: number; value: number } {
  let next = state >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;
  return { state: next, value: next / 0x1_0000_0000 };
}

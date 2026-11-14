import { describe, expect, it } from 'vitest';
import { cachedCalculation, withCalculationCache } from '../src/world/pure-cache';

describe('validation-local calculations', () => {
  const calculation = Symbol('example');
  it('does not reuse results after a caller edits the same input between validations', () => {
    const input = { value: 1 };
    const read = () => cachedCalculation(input, calculation, '', () => input.value);
    expect(withCalculationCache(read)).toBe(1);
    input.value = 2;
    expect(withCalculationCache(read)).toBe(2);
    input.value = 3;
    expect(read()).toBe(3);
  });

  it('reuses only identical calculations within a scope and isolates nested validations', () => {
    const owner = {}, other = {}, second = Symbol('second');
    let calls = 0;
    const read = (object = owner, namespace = calculation, key = '') => cachedCalculation(object, namespace, key, () => ++calls);
    withCalculationCache(() => {
      expect([read(), read()]).toEqual([1, 1]);
      expect(read(other)).toBe(2);
      expect(read(owner, second)).toBe(3);
      expect(read(owner, calculation, 'another')).toBe(4);
      expect(withCalculationCache(() => read())).toBe(5);
      expect(read()).toBe(1);
    });
    expect(read()).toBe(6);
  });

  it('releases a failed validation scope and never memoizes failed calculations', () => {
    const input = {};
    let calls = 0;
    const read = () => cachedCalculation(input, calculation, '', () => ++calls);
    expect(() => withCalculationCache(() => { read(); throw new Error('invalid'); })).toThrow('invalid');
    expect(withCalculationCache(read)).toBe(2);
    withCalculationCache(() => {
      expect(() => cachedCalculation(input, calculation, 'bad', () => { throw new Error('bad'); })).toThrow('bad');
      expect(cachedCalculation(input, calculation, 'bad', () => 'repaired')).toBe('repaired');
    });
  });

  it('bounds retained calculation results without changing evicted answers', () => {
    const owner = {};
    let calls = 0;
    withCalculationCache(() => {
      const read = (key: number) => cachedCalculation(owner, calculation, String(key), () => { calls += 1; return key * 2; });
      for (let key = 0; key < 129; key += 1) expect(read(key)).toBe(key * 2);
      expect(read(128)).toBe(256);
      expect(calls).toBe(129);
      expect(read(0)).toBe(0);
      expect(calls).toBe(130);
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Basic Module Tests', () => {
  let gjs: any;

  beforeAll(async () => {
    try {
      gjs = await import('../src/index.js');
      gjs.init();
    } catch (e) {
      console.log('Skipping basic tests - load failed:', e);
    }
  });

  afterAll(() => {
  });

  it('should export init function', () => {
    expect(gjs.init).toBeDefined();
    expect(typeof gjs.init).toBe('function');
  });

  it('should export imports object', () => {
    expect(gjs.imports).toBeDefined();
    expect(gjs.imports.gi).toBeDefined();
  });

  it('should have gi proxy', () => {
    const gi = gjs.imports.gi;
    expect(gi).toBeDefined();
    expect(typeof gi).toBe('object');
  });

  it('should support gi.versions', () => {
    const gi = gjs.imports.gi;
    expect(gi.versions).toBeDefined();
    expect(typeof gi.versions).toBe('object');
  });
});

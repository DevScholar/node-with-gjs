import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('GLib Tests', () => {
  let gjs: any;
  let GLib: any;

  beforeAll(async () => {
    try {
      gjs = await import('../src/index.js');
      gjs.init();
      const gi = gjs.imports.gi;
      GLib = gi.GLib;
    } catch (e) {
      console.log('Skipping GLib tests - load failed:', e);
    }
  }, 60000);

  afterAll(() => {
  });

  it('should load GLib namespace', () => {
    expect(GLib).toBeDefined();
  });

  it('should get user name', () => {
    const userName = GLib.get_user_name();
    expect(userName).toBeDefined();
    expect(typeof userName).toBe('string');
  });

  it('should get home dir', () => {
    const home = GLib.get_home_dir();
    expect(home).toBeDefined();
    expect(typeof home).toBe('string');
  });

  it('should get tmp dir', () => {
    const tmp = GLib.get_tmp_dir();
    expect(tmp).toBeDefined();
    expect(typeof tmp).toBe('string');
  });
});

describe('GObject Tests', () => {
  let gjs: any;
  let GObject: any;

  beforeAll(async () => {
    try {
      gjs = await import('../src/index.js');
      gjs.init();
      const gi = gjs.imports.gi;
      GObject = gi.GObject;
    } catch (e) {
      console.log('Skipping GObject tests - load failed:', e);
    }
  }, 60000);

  afterAll(() => {
  });

  it('should load GObject namespace', () => {
    expect(GObject).toBeDefined();
  });

  it('should have type system', () => {
    expect(GObject.type_from_name).toBeDefined();
    expect(GObject.type_register_fundamental).toBeDefined();
  });
});

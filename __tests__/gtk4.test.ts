import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('GTK4 GUI Tests', () => {
  let gjs: any;
  let Gtk: any;
  let GLib: any;

  beforeAll(async () => {
    try {
      gjs = await import('../src/index.js');
      gjs.init();
      const gi = gjs.imports.gi;
      gi.versions.Gtk = '4.0';
      Gtk = gi.Gtk;
      GLib = gi.GLib;
      Gtk.init();
    } catch (e) {
      console.log('Skipping GTK4 tests - load failed:', e);
    }
  }, 60000);

  afterAll(() => {
  });

  it('should load Gtk namespace', () => {
    expect(Gtk).toBeDefined();
    expect(Gtk.Application).toBeDefined();
  });

  it('should load GLib namespace', () => {
    expect(GLib).toBeDefined();
  });

  it('should create an Application instance', () => {
    const app = new Gtk.Application({ application_id: 'org.test.app' });
    expect(app).toBeDefined();
  });

  it('should create a Box container', () => {
    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10 });
    expect(box).toBeDefined();
  });

  it('should create a Label', () => {
    const label = new Gtk.Label({ label: 'Test Label' });
    expect(label).toBeDefined();
    expect(label.get_label()).toBe('Test Label');
  });

  it('should create a Button', () => {
    const button = new Gtk.Button({ label: 'Click Me' });
    expect(button).toBeDefined();
  });

  it('should set Label text', () => {
    const label = new Gtk.Label({ label: 'Initial' });
    label.set_label('Updated');
    expect(label.get_label()).toBe('Updated');
  });

  it('should use Orientation enum', () => {
    expect(Gtk.Orientation.VERTICAL).toBeDefined();
    expect(Gtk.Orientation.HORIZONTAL).toBeDefined();
  });

  it('should use Align enum', () => {
    expect(Gtk.Align.CENTER).toBeDefined();
    expect(Gtk.Align.START).toBeDefined();
    expect(Gtk.Align.END).toBeDefined();
  });
});

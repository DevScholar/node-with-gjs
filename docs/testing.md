# Testing Guide

This document describes how to run tests for the `node-with-gjs` project.

## Running Tests

### Run All Tests

```bash
npm test
```

### Run Specific Test Files

Pass a filename pattern directly to Vitest:

```bash
npm test -- gtk4
npm test -- glib
npm test -- basic
```

## Test Configuration

Tests must run **serially** because the module uses a singleton pattern with global state for the IPC connection to GJS. Running tests in parallel would cause conflicts between multiple GJS processes. Configure this in `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }
  }
});
```

## Test Files

Test files are located in the `__tests__` directory:

| File | Description |
|------|-------------|
| `basic.test.ts` | Basic module functionality tests (init, imports.gi) |
| `gtk4.test.ts` | GTK4 GUI component tests (Application, Box, Label, Button, enums) |
| `glib.test.ts` | GLib and GObject tests (get_user_name, get_home_dir, etc.) |

> **Note:** The `__tests__/` directory and test files are not yet included in the repository. Contributions welcome.

## Platform Support

| Platform | Support |
|----------|---------|
| Linux | All tests run normally |
| macOS | Tests are skipped (GJS is Linux-only) |
| Windows | Tests are skipped (GJS is Linux-only) |

Tests automatically detect the platform and skip on non-Linux systems.

## GUI Testing

GUI tests create GTK objects in memory without displaying windows. This allows testing without interfering with the desktop environment. The tests verify:

- Object creation (Application, Window, Box, Label, Button)
- Property getters/setters
- Method calls
- Enum values

For testing with actual window display and event handling, see the [node-with-gjs-examples](https://github.com/devscholar/node-with-gjs-examples) repository.

## Writing New Tests

When writing new tests, keep in mind:

1. **Initialize the module**: Always call `gjs.init()` in `beforeAll`
2. **Set GTK version**: Use `gi.versions.Gtk = '4.0'` before accessing Gtk
3. **Initialize GTK**: Call `Gtk.init()` before creating GTK objects
4. **Platform check**: Tests automatically skip on non-Linux platforms via `const isLinux = process.platform === 'linux' || process.platform === 'darwin'`

Example test structure:

```typescript
const isLinux = process.platform === 'linux' || process.platform === 'darwin';

(isLinux ? describe : describe.skip)('My Tests', () => {
  let gjs: any;
  let Gtk: any;

  beforeAll(async () => {
    try {
      gjs = await import('../src/index.js');
      gjs.init();
      const gi = gjs.imports.gi;
      gi.versions.Gtk = '4.0';
      Gtk = gi.Gtk;
      Gtk.init();
    } catch (e) {
      console.log('Skipping tests - load failed:', e);
    }
  }, 60000);

  afterAll(() => {
    // Cleanup if needed
  });

  it('should create a widget', () => {
    const widget = new Gtk.Label({ label: 'Test' });
    expect(widget).toBeDefined();
  });
});
```

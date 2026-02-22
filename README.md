# Node with GJS

⚠️ This project is still in pre-alpha stage, and API is subject to change.

This is a project that brings GNOME's GJS (GObject Introspection JavaScript runtime) to Node.js, allowing you to use GTK4 and WebKit from JavaScript/TypeScript with a Node.js-like API. Since this project uses IPC instead of C++ Addon, it is compatible not only with Node but also with Deno and Bun.

# Requirements

- Linux with GTK4 and WebKitGTK 6.0 installed
- Node.js 22+ (or Deno/Bun)
- bash (for Unix pipe IPC)

## Installation

Note: These packages are supposed to be pre-installed with GNOME-based Linux distros:

For Ubuntu/Debian:
```bash
apt install libgtk-4-1 libwebkitgtk-6.0-0 gjs
```

For Fedora:
```bash
dnf install gtk4 webkitgtk6.0 gjs
```

For Arch Linux:
```bash
pacman -S gtk4 webkitgtk-6.0 gjs
```

# Usage

## Runtime Support

| Runtime | `gi://` URL Syntax | Loader Hooks |
|---------|-------------------|--------------|
| Node.js | ✅ Supported | ✅ `--experimental-loader` |
| Bun | ❌ Not supported | ❌ No hooks mechanism |
| Deno | ❌ Not supported | ❌ No hooks mechanism |

## Node.js

Node.js supports the `gi://` URL syntax, which is consistent with GJS:

```typescript
import Gtk from 'gi://Gtk?version=4.0';
import WebKit from 'gi://WebKit?version=6.0';

const app = new Gtk.Application({ application_id: 'org.example.app' });
// ...
```

## Bun / Deno

Bun and Deno do not support Node.js loader hooks, so you need to use the `loadGi` function instead:

```typescript
import { loadGi } from './gi-loader.ts';

const Gtk = loadGi('Gtk', '4.0');
const WebKit = loadGi('WebKit', '6.0');

const app = new Gtk.Application({ application_id: 'org.example.app' });
// ...
```

**Note:** The `loadGi` function also works with Node.js, useful for older Node.js versions or when not using experimental loader flags.

# Examples

## Console Apps

### Console Input App

```bash
node start.js examples/console/console-input/console-input.ts
```

### Await Delay App

```bash
node start.js examples/console/await-delay/await-delay.ts
```

## GUI Apps

### GTK4 Counter App

```bash
node start.js examples/gtk/counter/counter.ts
```

### GTK4 WebKit Counter App

```bash
node start.js examples/gtk-webkit/counter/counter.ts
```

### Adwaita Counter App (libadwaita)

A counter example based on [libadwaita](https://gnome.pages.gitlab.gnome.org/libadwaita/), demonstrating how to use Adwaita-specific components like `Adw.ApplicationWindow` and `Adw.Clamp`.

```bash
node start.js examples/adwaita/counter/counter.ts
```

# License

This project is licensed under the MIT License.

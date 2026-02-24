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

## Universal API (Recommended)

All runtimes (Node.js, Bun, Deno) use the same API, compatible with traditional GJS:

```typescript
import { imports } from './gi-loader.ts';

const { Gtk, WebKit } = imports.gi;

const app = new Gtk.Application({ application_id: 'org.example.app' });
// ...
```

### Specifying Versions

To specify a version for a namespace, set it before accessing the namespace:

```typescript
import { imports } from './gi-loader.ts';

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';

const { Gtk, Adw } = imports.gi;
```

## Runtime Support

| Runtime | `gi://` URL Syntax | Loader Hooks |
|---------|-------------------|--------------|
| Node.js | ✅ Supported | ✅ `--experimental-loader` |
| Bun | ❌ Not supported | ❌ No hooks mechanism |
| Deno | ❌ Not supported | ❌ No hooks mechanism |

## Node.js (Alternative)

Node.js also supports the `gi://` URL syntax with experimental loader:

```typescript
import Gtk from 'gi://Gtk?version=4.0';
import WebKit from 'gi://WebKit?version=6.0';

const app = new Gtk.Application({ application_id: 'org.example.app' });
// ...
```

# Examples

Please visit the [node-with-gjs-examples](https://github.com/devscholar/node-with-gjs-examples) repository for working examples.

## Quick Start with Examples

Clone the examples repository alongside this project:

```bash
git clone https://github.com/devscholar/node-with-gjs-examples.git
cd node-with-gjs-examples
npm install
npm run counter
```

For more examples and details, see the [node-with-gjs-examples README](https://github.com/devscholar/node-with-gjs-examples).

# License

This project is licensed under the MIT License.

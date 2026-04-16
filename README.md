# node-with-gjs

> Beta

Brings GNOME's GJS (GObject Introspection JavaScript runtime) to Node.js, allowing you to use GTK, WebKit, Adwaita and any other GObject-based library from JavaScript/TypeScript. Uses IPC instead of a native addon, so it works with Node.js, Deno, and Bun.

## How it works

node-with-gjs spawns a GJS process and bridges it to Node.js via IPC. Your TypeScript code runs in Node.js; GTK/GLib calls are forwarded to GJS transparently. You write normal Node.js code and get full access to the GObject ecosystem.

## The only runtime dependency: GJS

node-with-gjs itself requires only **GJS** — the GNOME JavaScript runtime. It does not depend on any specific UI toolkit.

Which additional system libraries you need depends entirely on what your own code uses:

- GTK3 UI → install `libgtk-3-0` (and the corresponding `.gir` file)
- GTK4 UI → install `libgtk-4-1`
- WebKit → install `libwebkitgtk-6.0-0`
- Adwaita → install `libadwaita-1-0`

You only need the **runtime** packages, not the `-dev` packages. Dev packages (e.g. `libgtk-4-dev`) contain C/C++ header files for compiling C programs — GJS loads libraries at runtime via GObject Introspection and has no use for them.

## System package installation

Tested on **Ubuntu 24.04 LTS**. Install GJS (required) plus whichever toolkits your project uses:

```bash
# GJS (required)
sudo apt install gjs

# GTK3
sudo apt install libgtk-3-0 gir1.2-gtk-3.0

# GTK4
sudo apt install libgtk-4-1 gir1.2-gtk-4.0

# WebKitGTK (GTK4-based)
sudo apt install libwebkitgtk-6.0-0 gir1.2-webkit2-4.1

# Adwaita
sudo apt install libadwaita-1-0 gir1.2-adw-1
```

GNOME-based Ubuntu installs typically pre-install GJS, GTK4, and Adwaita. On a minimal install you may need to add them manually.

For other distributions, consult your package manager for the equivalent packages.

## About the `@girs/*` npm packages

The `@girs/*` packages (e.g. `@girs/gtk-4.0`, `@girs/gtk-3.0`) are **TypeScript type definitions only**. They are devDependencies and have zero effect at runtime. They exist so your editor and `tsc` can type-check calls to GTK/GLib APIs. The actual implementation is provided by the system GObject Introspection data (`.gir` files).

## Node.js version

Node.js 18+ (LTS recommended). Also compatible with Bun and Deno.

## Installation

```bash
npm install @devscholar/node-with-gjs
```

## Usage

See the [node-with-gjs-examples](https://github.com/devscholar/node-with-gjs-examples) repository for examples covering GTK3, GTK4, WebKit, Adwaita, and console I/O.

## Tests

```bash
npm test
```

For detailed testing documentation, see [docs/testing.md](docs/testing.md).

## License

MIT

# Node with GJS

This project is in Beta stage.

This is a project that brings GNOME's GJS (GObject Introspection JavaScript runtime) to Node.js, allowing you to use GTK4 and WebKit from JavaScript/TypeScript with a Node.js-like API. Since this project uses IPC instead of C++ Addon, it is compatible not only with Node but also with Deno and Bun.

# Requirements

- Linux with GTK4 and WebKitGTK 6.0 installed
- Node.js 18+ (LTS version recommended, or Deno/Bun)
- bash (for Unix pipe IPC)

## Installation

Note: These packages are supposed to be pre-installed with GNOME-based Linux distros:

For Ubuntu/Debian:
```bash
apt install libgtk-4-1 libwebkitgtk-6.0-0 gjs gir1.2-adw-1
```

# Usage

For more examples and details, see the [node-with-gjs-examples README](https://github.com/devscholar/node-with-gjs-examples).

# Tests

Run all tests:

```bash
npm test
```

For detailed testing documentation, see [docs/testing.md](docs/testing.md).

# License

This project is licensed under the MIT License.

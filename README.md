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

For more examples and details, see the [node-with-gjs-examples README](https://github.com/devscholar/node-with-gjs-examples).

# License

This project is licensed under the MIT License.

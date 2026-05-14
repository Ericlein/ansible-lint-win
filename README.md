# ansible-lint-win

[![npm](https://img.shields.io/npm/v/ansible-lint-win)](https://www.npmjs.com/package/ansible-lint-win)
[![license](https://img.shields.io/npm/l/ansible-lint-win)](LICENSE)
[![Socket Badge](https://badge.socket.dev/npm/package/ansible-lint-win/0.1.3)](https://socket.dev/npm/package/ansible-lint-win)

A lightweight Ansible language server for **Windows**, built as a Zed extension. **No Python, no ansible-lint, no WSL required.**

## Why this exists

Ansible has no Windows control-node support. The `ansible` Python package — and everything built on top of it, including [`ansible-language-server`](https://github.com/ansible/ansible-language-server) and `ansible-lint` — is Linux-only by design. Ansible can manage Windows hosts, but the controller itself doesn't run on Windows, so the official LSP doesn't either. WSL is the only way to get the official toolchain working on a Windows dev machine, and that comes with all the friction you'd expect: a separate filesystem, PATH gymnastics, slow startup, and an editor integration story that fights you the whole way.

`ansible-lint-win` sidesteps the problem entirely. It's a pure Node.js LSP that doesn't depend on Ansible itself — just module metadata, which it ships pre-generated for 120+ collections. One install, no Python, no WSL, fully offline.

> **Platform support:** Developed and tested on Windows + Zed. The server is plain Node.js, so it should run anywhere Node runs and work with any LSP-compatible editor — but those combinations aren't officially tested. Reports welcome.

## Features

- **Completions** — context-aware: play keywords, task keywords, module FQCNs (filterable by short name), module options (required first), value choices
- **Hover documentation** — module docs with options table, option details, keyword descriptions
- **10 lint rules** — name-required, fqcn-required, yaml-truthy, no-changed-when, key-order, jinja-spacing, no-duplicate-keys, play-has-hosts, deprecated-modules, no-free-form
- **Go-to-definition** — Ctrl+click on `include_tasks`, `import_tasks`, `vars_files`, `roles`, and template `src` paths
- **8900+ modules** from 120+ collections out of the box, with support for auto-discovering all collections from the ansible-collections GitHub org

---

## Install in Zed

The extension is pending review in the Zed Extension Registry. Until then, install it as a dev extension (see [Developing](#developing) below).

Once accepted, install will be:

1. Open Zed
2. `Ctrl+Shift+P` / `Cmd+Shift+P` → **`zed: extensions`**
3. Search for **Ansible Lint Win** and install — the language server auto-installs from npm

Then add the file-type associations to your Zed settings (`Ctrl+Shift+P` → "open settings"). A reference config is in [`settings.example.json`](settings.example.json):

```json
{
  "languages": {
    "Ansible": { "tab_size": 2 }
  },
  "file_types": {
    "Ansible": [
      "**.ansible.yml",
      "**.ansible.yaml",
      "**/tasks/*.yml",
      "**/handlers/*.yml",
      "**/playbooks/*.yml",
      "**/roles/**/tasks/*.yml",
      "**site.yml"
    ]
  }
}
```

(See `settings.example.json` for the full set of patterns.)

---

## Using with Other Editors

The server is published to npm and speaks standard LSP over stdio, so any editor with LSP support can in principle use it:

```bash
npm install -g ansible-lint-win
node "$(npm root -g)/ansible-lint-win/dist/server.js" --stdio
```

This path hasn't been officially tested. If you wire it up to Neovim, Helix, VS Code, or any other LSP-capable editor and it works (or doesn't), [open an issue](https://github.com/Ericlein/ansible-lint-win/issues) — happy to add documented configurations.

---

## Developing

If you want to hack on the server or extension locally:

```bash
# Build the server
cd server
npm install
npm run bundle         # esbuild → single dist/server.js

# Sideload the extension in Zed
# Command palette → "zed: install dev extension" → select the extension/ directory
```

### Refreshing module data

Module data is pre-generated from GitHub. To regenerate:

```bash
cd server

# Fetch specific collections (no token needed for a few)
npm run generate-data -- community.general ansible.windows amazon.aws

# Fetch ALL collections (auto-discovers from the ansible-collections GitHub org)
GITHUB_TOKEN=ghp_xxx npm run generate-data
```

### Project structure

```
ansible-lint-win/
├── server/                     # Node.js language server (published to npm)
│   ├── src/
│   │   ├── server.ts           # LSP entry point
│   │   ├── parser/             # YAML parsing + context detection
│   │   └── providers/          # completion, hover, diagnostics, definition
│   ├── data/                   # Pre-generated JSON (modules, keywords)
│   └── dist/                   # Build output (shipped to npm)
│
├── extension/                  # Zed extension (Rust → WASM)
│   ├── extension.toml
│   ├── Cargo.toml
│   ├── src/lib.rs
│   └── languages/ansible/      # Language config + syntax highlights
│
└── scripts/
    └── generate-module-data.ts # Fetches module docs from GitHub
```

---

## License

MIT — see [LICENSE](LICENSE).

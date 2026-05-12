# ansible-lint-win

[![npm](https://img.shields.io/npm/v/ansible-lint-win)](https://www.npmjs.com/package/ansible-lint-win)
[![license](https://img.shields.io/npm/l/ansible-lint-win)](LICENSE)
[![Socket Badge](https://badge.socket.dev/npm/package/ansible-lint-win/0.1.3)](https://socket.dev/npm/package/ansible-lint-win)

A lightweight Ansible language server that runs natively on Windows (and everywhere else Node.js runs) **without requiring Python, ansible-lint, or WSL**.

## Why this exists

The official [ansible-language-server](https://github.com/ansible/ansible-language-server) requires a working Python environment with `ansible-lint` installed. On Windows that means setting up WSL, dealing with PATH issues, and accepting a multi-second startup. For developers who just want completions and hover docs while authoring playbooks — especially on Windows — that's a lot of overhead.

`ansible-lint-win` is a pure Node.js LSP: one `npm install`, no Python, no WSL, no global tooling. It ships pre-generated module metadata for 120+ collections so it works fully offline.

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

## Install for Other LSP-Compatible Editors

The language server is on npm. Install it globally:

```bash
npm install -g ansible-lint-win
```

Find the path to the installed server:

```bash
npm root -g
# e.g. C:\Users\you\AppData\Roaming\npm\node_modules   (Windows)
# e.g. /usr/local/lib/node_modules                     (macOS/Linux)
```

The server is at `<npm-root>/ansible-lint-win/dist/server.js`. Substitute that path in the examples below.

### Neovim (nvim-lspconfig)
```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

configs.ansible_lint_win = {
  default_config = {
    cmd = { 'node', '<npm-root>/ansible-lint-win/dist/server.js', '--stdio' },
    filetypes = { 'yaml', 'yaml.ansible' },
    root_dir = lspconfig.util.root_pattern('ansible.cfg', '.ansible-lint', 'inventory', 'playbooks'),
  },
}

lspconfig.ansible_lint_win.setup({})
```

### Helix (`~/.config/helix/languages.toml`)
```toml
[language-server.ansible-lint-win]
command = "node"
args = ["<npm-root>/ansible-lint-win/dist/server.js", "--stdio"]

[[language]]
name = "yaml"
language-servers = ["ansible-lint-win"]
```

### Sublime Text (LSP package)
```json
{
  "clients": {
    "ansible-lint-win": {
      "enabled": true,
      "command": ["node", "<npm-root>/ansible-lint-win/dist/server.js", "--stdio"],
      "selector": "source.yaml"
    }
  }
}
```

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

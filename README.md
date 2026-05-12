# ansible-lint-win
[![NPM](https://nodei.co/npm/ansible-lint-win.svg?style=shields)](https://www.npmjs.com/package/ansible-lint-win)
[![Socket Badge](https://badge.socket.dev/npm/package/ansible-lint-win/0.1.3)](https://badge.socket.dev/npm/package/ansible-lint-win/0.1.3)


A lightweight Ansible language server that runs natively on Windows (and everywhere else Node.js runs) **without requiring Python, ansible-lint, or WSL**.

Built as a Node.js LSP server with a Zed extension wrapper.

## Features

- **Completions** — context-aware: play keywords, task keywords, module FQCNs (filterable by short name), module options (required first), value choices
- **Hover documentation** — module docs with options table, option details, keyword descriptions
- **10 lint rules** — name-required, fqcn-required, yaml-truthy, no-changed-when, key-order, jinja-spacing, no-duplicate-keys, play-has-hosts, deprecated-modules, no-free-form
- **Go-to-definition** — Ctrl+click on `include_tasks`, `import_tasks`, `vars_files`, `roles`, and template `src` paths
- **8900+ modules** from 120+ collections out of the box, with support for auto-discovering all collections from the ansible-collections GitHub org

---

## Install in Zed

Once published to the Zed Extension Registry:

1. Open Zed
2. `Ctrl+Shift+P` / `Cmd+Shift+P` → **`zed: extensions`**
3. Search for **Ansible Lint Win** and install

The extension auto-installs the language server from npm — no build steps required.

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

Then point your editor at `node_modules/ansible-lint-win/dist/server.js`.

### Neovim (nvim-lspconfig)
```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

configs.ansible_lint_win = {
  default_config = {
    cmd = { 'node', vim.fn.expand('$HOME/.npm-global/lib/node_modules/ansible-lint-win/dist/server.js'), '--stdio' },
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
args = ["/path/to/global/node_modules/ansible-lint-win/dist/server.js", "--stdio"]

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
      "command": ["node", "/path/to/global/node_modules/ansible-lint-win/dist/server.js", "--stdio"],
      "selector": "source.yaml"
    }
  }
}
```

> Tip: find your global `node_modules` path with `npm root -g`.

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

---

## Project Structure

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

## License

MIT

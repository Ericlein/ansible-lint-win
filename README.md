# ansible-lint-win

A lightweight Ansible language server that runs natively on Windows (and everywhere else Node.js runs) **without requiring Python, ansible-lint, or WSL**.

Built as a Node.js LSP server with a Zed extension wrapper.

## Features

- **Completions** — context-aware: play keywords, task keywords, module FQCNs (filterable by short name), module options (required first), value choices
- **Hover documentation** — module docs with options table, option details, keyword descriptions
- **10 lint rules** — name-required, fqcn-required, yaml-truthy, no-changed-when, key-order, jinja-spacing, no-duplicate-keys, play-has-hosts, deprecated-modules, no-free-form
- **Go-to-definition** — Ctrl+click on include_tasks, import_tasks, vars_files, roles, and template src paths
- **2600+ modules** from 80+ collections out of the box, with support for auto-discovering all collections from the ansible-collections GitHub org

## Requirements

- **Node.js** v18+ on your PATH
- **Zed** editor (for the extension) — or any editor that supports LSP servers

---

## Quick Start: Use with Zed (Dev Extension)

This is the fastest way to try it locally.

### 1. Build the server

```bash
cd server
npm install
npm run build          # TypeScript → dist/
npm run bundle         # esbuild → single dist/server.js
```

### 2. Install as Zed dev extension

1. Open Zed
2. Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Run **"zed: install dev extension"**
4. Select the `extension/` directory in this repo
5. Zed will compile the Rust wrapper to WASM and activate it

> **Note:** You need Rust installed via [rustup](https://rustup.rs/) (not Homebrew) for Zed to compile the extension.

### 3. Configure Zed settings

Add the following to your Zed settings (`Ctrl+Shift+P` → "open settings"). A reference config is included in [`settings.example.json`](settings.example.json).

```json
{
  "languages": {
    "Ansible": { "tab_size": 2 }
  },
  "file_types": {
    "Ansible": [
      "**.ansible.yml",
      "**.ansible.yaml",
      "**/defaults/*.yml",
      "**/defaults/*.yaml",
      "**/meta/*.yml",
      "**/meta/*.yaml",
      "**/tasks/*.yml",
      "**/tasks/*.yaml",
      "**/handlers/*.yml",
      "**/handlers/*.yaml",
      "**/group_vars/*.yml",
      "**/group_vars/*.yaml",
      "**/host_vars/*.yml",
      "**/host_vars/*.yaml",
      "**/playbooks/*.yaml",
      "**/playbooks/*.yml",
      "**playbook*.yaml",
      "**playbook*.yml",
      "**/roles/**/tasks/*.yml",
      "**/roles/**/tasks/*.yaml",
      "**/roles/**/handlers/*.yml",
      "**/roles/**/handlers/*.yaml",
      "**/roles/**/defaults/*.yml",
      "**/roles/**/defaults/*.yaml",
      "**/roles/**/vars/*.yml",
      "**/roles/**/vars/*.yaml",
      "**/roles/**/meta/*.yml",
      "**/roles/**/meta/*.yaml",
      "**/vars/*.yml",
      "**/vars/*.yaml",
      "**/inventory/*.yml",
      "**/inventory/*.yaml",
      "**site.yml",
      "**site.yaml"
    ]
  }
}
```

### 4. Open an Ansible YAML file

Open any `.yml` or `.yaml` file and you should get completions, hover docs, lint diagnostics, and go-to-definition.

---

## Quick Start: Use with Any LSP-Compatible Editor

The language server is a standalone Node.js process that communicates over stdio.

### Build

```bash
cd server
npm install
npm run bundle
```

### Run

```bash
node server/dist/server.js --stdio
```

### Editor Configuration Examples

**Neovim (nvim-lspconfig)**
```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

configs.ansible_lite = {
  default_config = {
    cmd = { 'node', '/path/to/ansible-lint-win/server/dist/server.js', '--stdio' },
    filetypes = { 'yaml', 'yaml.ansible' },
    root_dir = lspconfig.util.root_pattern('ansible.cfg', '.ansible-lint', 'inventory', 'playbooks'),
  },
}

lspconfig.ansible_lite.setup({})
```

**Helix** (`~/.config/helix/languages.toml`)
```toml
[language-server.ansible-lint-win]
command = "node"
args = ["/path/to/ansible-lint-win/server/dist/server.js", "--stdio"]

[[language]]
name = "yaml"
language-servers = ["ansible-lint-win"]
```

**Sublime Text (LSP package)**
```json
{
  "clients": {
    "ansible-lint-win": {
      "enabled": true,
      "command": ["node", "/path/to/ansible-lint-win/server/dist/server.js", "--stdio"],
      "selector": "source.yaml"
    }
  }
}
```

---

## Refreshing Module Data

Module data is pre-generated from GitHub. To update or regenerate it:

```bash
cd server

# Fetch specific collections (no token needed for a few)
npm run generate-data -- community.general ansible.windows amazon.aws

# Fetch ALL collections (auto-discovers from ansible-collections GitHub org)
# Requires a GitHub token due to the number of API calls
GITHUB_TOKEN=ghp_xxx npm run generate-data
```

The script auto-discovers every collection in the `ansible-collections` GitHub org. Pass specific collection names as arguments to only fetch those.

---

## Publishing to the Zed Extension Registry

Once you're ready to publish:

1. **Publish the server to npm** so Zed can auto-install it:
   ```bash
   cd server
   npm publish
   ```

2. **Fork** [zed-industries/extensions](https://github.com/zed-industries/extensions)

3. **Add your extension as a Git submodule** (must use HTTPS URL):
   ```bash
   cd extensions
   git submodule add https://github.com/Ericlein/ansible-linting-windows.git extensions/ansible-lint-win
   ```

4. **Add an entry** to the repo's `extensions.toml`:
   ```toml
   [ansible-lint-win]
   submodule = "extensions/ansible-lint-win"
   version = "0.1.0"
   ```

5. Run `pnpm sort-extensions` and submit a PR

### Requirements for Publishing
- Must have an accepted license (MIT, Apache 2.0, BSD, GPL, etc.)
- Extension ID must not contain "zed" or "Zed"
- Submodule URL must be HTTPS (not SSH)

---

## Project Structure

```
ansible-lint-win/
├── server/                     # Node.js language server
│   ├── src/
│   │   ├── server.ts           # LSP entry point
│   │   ├── parser/             # YAML parsing + context detection
│   │   ├── providers/          # completion, hover, diagnostics, definition
│   │   └── data/               # type definitions + data loader
│   ├── data/                   # Pre-generated JSON (modules, keywords)
│   │   ├── modules/            # One file per collection
│   │   └── keywords/           # play.json, task.json, block.json, role.json
│   └── dist/                   # Build output
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

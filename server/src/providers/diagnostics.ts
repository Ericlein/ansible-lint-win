import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { modulesByFQCN, modulesByShortName, shortNameToFQCN } from '../data/loader';

export interface LintRule {
  id: string;
  description: string;
  severity: DiagnosticSeverity;
  check(lines: string[], text: string): Diagnostic[];
}

const rules: LintRule[] = [];

// ─── Rule: name-required ───────────────────────────────────────────────────
rules.push({
  id: 'name-required',
  description: 'Tasks and plays should have a name',
  severity: DiagnosticSeverity.Warning,
  check(lines) {
    const diagnostics: Diagnostic[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Detect task-level entries (indented "- module:" pattern without a preceding "name:")
      const taskMatch = line.match(/^(\s*)- ([\w.]+):\s*/);
      if (!taskMatch) continue;
      const indent = taskMatch[1].length;
      const key = taskMatch[2];
      // Skip if this is name itself, or not a module
      if (key === 'name' || key === 'block') continue;
      if (!modulesByFQCN.has(key) && !modulesByShortName.has(key)) continue;

      // Check if there's a "name:" in this task block
      let hasName = false;
      // Look at subsequent lines at same or deeper indent
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trimStart();
        if (next === '' || next.startsWith('#')) continue;
        const nextIndent = lines[j].search(/\S/);
        if (nextIndent <= indent && !lines[j].match(/^\s+\w/)) break;
        if (lines[j].match(new RegExp(`^\\s{${indent + 2}}name:`))) {
          hasName = true;
          break;
        }
      }
      // Also check preceding line for "- name:"
      if (i > 0 && lines[i - 1].match(new RegExp(`^\\s{${indent}}name:`))) {
        hasName = true;
      }
      // Check if "- name:" is on a prior line within same task
      for (let j = i - 1; j >= 0; j--) {
        const prev = lines[j].trimStart();
        if (prev === '' || prev.startsWith('#')) continue;
        const prevIndent = lines[j].search(/\S/);
        if (prevIndent < indent) break;
        if (lines[j].match(new RegExp(`^\\s{${indent}}- name:`)) || lines[j].match(new RegExp(`^\\s{${indent + 2}}name:`))) {
          hasName = true;
          break;
        }
      }

      if (!hasName) {
        diagnostics.push({
          range: Range.create(i, indent + 2, i, indent + 2 + key.length),
          message: `Task is missing a "name" attribute (name-required)`,
          severity: DiagnosticSeverity.Warning,
          source: 'ansible-ls-lite',
        });
      }
    }
    return diagnostics;
  },
});

// ─── Rule: fqcn-required ───────────────────────────────────────────────────
rules.push({
  id: 'fqcn-required',
  description: 'Use fully qualified collection names',
  severity: DiagnosticSeverity.Warning,
  check(lines) {
    const diagnostics: Diagnostic[] = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(\s*)-?\s*([\w]+):\s*/);
      if (!match) continue;
      const key = match[2];
      if (shortNameToFQCN[key] && !key.includes('.')) {
        const col = lines[i].indexOf(key);
        diagnostics.push({
          range: Range.create(i, col, i, col + key.length),
          message: `Use FQCN "${shortNameToFQCN[key]}" instead of "${key}" (fqcn-required)`,
          severity: DiagnosticSeverity.Warning,
          source: 'ansible-ls-lite',
        });
      }
    }
    return diagnostics;
  },
});

// ─── Rule: yaml-truthy ────────────────────────────────────────────────────
rules.push({
  id: 'yaml-truthy',
  description: 'Use true/false instead of yes/no',
  severity: DiagnosticSeverity.Warning,
  check(lines) {
    const diagnostics: Diagnostic[] = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/:\s+(yes|no|Yes|No|YES|NO)\s*$/);
      if (match) {
        const col = lines[i].lastIndexOf(match[1]);
        diagnostics.push({
          range: Range.create(i, col, i, col + match[1].length),
          message: `Use "${match[1].toLowerCase() === 'yes' ? 'true' : 'false'}" instead of "${match[1]}" (yaml-truthy)`,
          severity: DiagnosticSeverity.Warning,
          source: 'ansible-ls-lite',
        });
      }
    }
    return diagnostics;
  },
});

// ─── Rule: no-changed-when ────────────────────────────────────────────────
rules.push({
  id: 'no-changed-when',
  description: 'command/shell/raw tasks should have changed_when',
  severity: DiagnosticSeverity.Warning,
  check(lines) {
    const diagnostics: Diagnostic[] = [];
    const cmdModules = new Set([
      'command', 'shell', 'raw',
      'ansible.builtin.command', 'ansible.builtin.shell', 'ansible.builtin.raw',
    ]);

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(\s*)-?\s*([\w.]+):/);
      if (!match || !cmdModules.has(match[2])) continue;

      const indent = match[1].length;
      let hasChangedWhen = false;

      // Scan the task block
      for (let j = i - 5; j < Math.min(lines.length, i + 20); j++) {
        if (j < 0) continue;
        if (/changed_when:|check_mode:/.test(lines[j])) {
          hasChangedWhen = true;
          break;
        }
      }

      if (!hasChangedWhen) {
        const col = lines[i].indexOf(match[2]);
        diagnostics.push({
          range: Range.create(i, col, i, col + match[2].length),
          message: `Task uses "${match[2]}" without "changed_when" or "check_mode" (no-changed-when)`,
          severity: DiagnosticSeverity.Warning,
          source: 'ansible-ls-lite',
        });
      }
    }
    return diagnostics;
  },
});

// ─── Rule: key-order ──────────────────────────────────────────────────────
rules.push({
  id: 'key-order',
  description: '"name" should be the first key in a task',
  severity: DiagnosticSeverity.Hint,
  check(lines) {
    const diagnostics: Diagnostic[] = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(\s+)name:\s/);
      if (!match) continue;
      const indent = match[1].length;
      // Check if previous non-empty line at same indent has a different key
      for (let j = i - 1; j >= 0; j--) {
        const prev = lines[j];
        if (prev.trim() === '' || prev.trim().startsWith('#')) continue;
        const prevIndent = prev.search(/\S/);
        if (prevIndent < indent) break;
        if (prevIndent === indent && !prev.trim().startsWith('-') && !prev.trim().startsWith('name:')) {
          diagnostics.push({
            range: Range.create(i, indent, i, indent + 4),
            message: `"name" should be the first key in a task (key-order)`,
            severity: DiagnosticSeverity.Hint,
            source: 'ansible-ls-lite',
          });
          break;
        }
        break;
      }
    }
    return diagnostics;
  },
});

// ─── Rule: jinja-spacing ──────────────────────────────────────────────────
rules.push({
  id: 'jinja-spacing',
  description: 'Jinja2 expressions should have spaces: {{ var }}',
  severity: DiagnosticSeverity.Hint,
  check(lines) {
    const diagnostics: Diagnostic[] = [];
    const re = /\{\{(\S)|(\S)\}\}/g;
    for (let i = 0; i < lines.length; i++) {
      // Skip comments
      if (lines[i].trim().startsWith('#')) continue;
      let match;
      while ((match = re.exec(lines[i])) !== null) {
        diagnostics.push({
          range: Range.create(i, match.index, i, match.index + match[0].length),
          message: `Add spaces inside Jinja2 braces: "{{ var }}" (jinja-spacing)`,
          severity: DiagnosticSeverity.Hint,
          source: 'ansible-ls-lite',
        });
      }
    }
    return diagnostics;
  },
});

// ─── Rule: no-duplicate-keys ──────────────────────────────────────────────
rules.push({
  id: 'no-duplicate-keys',
  description: 'No duplicate keys in a mapping',
  severity: DiagnosticSeverity.Error,
  check(lines) {
    const diagnostics: Diagnostic[] = [];
    // Simple indent-based tracking
    const keysByIndent = new Map<number, Map<string, number>>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '' || line.trim().startsWith('#')) continue;

      const indent = line.search(/\S/);
      const keyMatch = line.match(/^(\s*)([\w.]+)\s*:/);
      if (!keyMatch) {
        // Reset tracking at list items
        if (line.trim().startsWith('-')) {
          // Clear deeper indents
          for (const [k] of keysByIndent) {
            if (k >= indent) keysByIndent.delete(k);
          }
        }
        continue;
      }

      const key = keyMatch[2];

      // Clear deeper indent keys when we encounter a key at this level
      for (const [k] of keysByIndent) {
        if (k > indent) keysByIndent.delete(k);
      }

      if (!keysByIndent.has(indent)) keysByIndent.set(indent, new Map());
      const keysAtLevel = keysByIndent.get(indent)!;

      if (keysAtLevel.has(key)) {
        const col = line.indexOf(key);
        diagnostics.push({
          range: Range.create(i, col, i, col + key.length),
          message: `Duplicate key "${key}" (no-duplicate-keys)`,
          severity: DiagnosticSeverity.Error,
          source: 'ansible-ls-lite',
        });
      } else {
        keysAtLevel.set(key, i);
      }
    }
    return diagnostics;
  },
});

// ─── Rule: play-has-hosts ─────────────────────────────────────────────────
rules.push({
  id: 'play-has-hosts',
  description: 'Plays must have a "hosts" key',
  severity: DiagnosticSeverity.Error,
  check(lines) {
    const diagnostics: Diagnostic[] = [];
    // Detect top-level list items (plays)
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].match(/^- \w+:/)) continue;

      // This might be a play - scan for hosts key
      let hasHosts = false;
      let endLine = i;
      for (let j = i; j < lines.length; j++) {
        if (j > i && lines[j].match(/^- \w+:/)) break;
        if (j > i && lines[j].match(/^\S/)) break;
        endLine = j;
        if (lines[j].match(/^\s*hosts:/)) {
          hasHosts = true;
          break;
        }
      }

      // Only warn if it looks like a play (has tasks/roles/name at top level)
      const playSlice = lines.slice(i, endLine + 1).join('\n');
      if ((playSlice.includes('tasks:') || playSlice.includes('roles:')) && !hasHosts) {
        diagnostics.push({
          range: Range.create(i, 0, i, lines[i].length),
          message: `Play is missing the "hosts" key (play-has-hosts)`,
          severity: DiagnosticSeverity.Error,
          source: 'ansible-ls-lite',
        });
      }
    }
    return diagnostics;
  },
});

// ─── Rule: deprecated-modules ─────────────────────────────────────────────
rules.push({
  id: 'deprecated-modules',
  description: 'Avoid deprecated modules',
  severity: DiagnosticSeverity.Warning,
  check(lines) {
    const diagnostics: Diagnostic[] = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(\s*)-?\s*([\w.]+):\s*/);
      if (!match) continue;
      const key = match[2];
      const mod = modulesByFQCN.get(key) || modulesByShortName.get(key);
      if (mod?.deprecated) {
        const col = lines[i].indexOf(key);
        diagnostics.push({
          range: Range.create(i, col, i, col + key.length),
          message: `Module "${key}" is deprecated: ${mod.deprecated} (deprecated-modules)`,
          severity: DiagnosticSeverity.Warning,
          source: 'ansible-ls-lite',
        });
      }
    }
    return diagnostics;
  },
});

// ─── Rule: no-free-form ───────────────────────────────────────────────────
rules.push({
  id: 'no-free-form',
  description: 'Avoid free-form syntax for command/shell modules',
  severity: DiagnosticSeverity.Warning,
  check(lines) {
    const diagnostics: Diagnostic[] = [];
    const freeFormModules = new Set([
      'command', 'shell', 'raw', 'script',
      'ansible.builtin.command', 'ansible.builtin.shell',
      'ansible.builtin.raw', 'ansible.builtin.script',
    ]);

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(\s*)-?\s*([\w.]+):\s+(.+)$/);
      if (!match) continue;
      const key = match[2];
      const value = match[3].trim();
      if (freeFormModules.has(key) && value && !value.startsWith('{') && !value.startsWith('|') && !value.startsWith('>')) {
        const col = lines[i].indexOf(key);
        diagnostics.push({
          range: Range.create(i, col, i, lines[i].length),
          message: `Avoid free-form syntax. Use "cmd:" option instead (no-free-form)`,
          severity: DiagnosticSeverity.Warning,
          source: 'ansible-ls-lite',
        });
      }
    }
    return diagnostics;
  },
});

// ─── Main diagnostics runner ──────────────────────────────────────────────

export function runDiagnostics(doc: TextDocument): Diagnostic[] {
  const text = doc.getText();
  const lines = text.split('\n');
  const diagnostics: Diagnostic[] = [];

  for (const rule of rules) {
    try {
      diagnostics.push(...rule.check(lines, text));
    } catch {
      // Don't let one rule crash diagnostics
    }
  }

  return diagnostics;
}

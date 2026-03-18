import { CompletionItem, CompletionItemKind, InsertTextFormat, Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseAnsibleDocument } from '../parser/document';
import { detectContext } from '../parser/ansible-context';
import {
  modulesByFQCN, modulesByShortName,
  playKeywords, taskKeywords, blockKeywords, roleKeywords,
} from '../data/loader';
import { ModuleDefinition } from '../data/keywords';

export function getCompletions(doc: TextDocument, position: Position): CompletionItem[] {
  const text = doc.getText();
  const lines = text.split('\n');
  const items: CompletionItem[] = [];

  // Try AST-based context detection first
  const parsed = parseAnsibleDocument(text);
  const ctx = detectContext(parsed, position);

  // Use line-based detection — more reliable with incomplete YAML
  fallbackCompletions(lines, position, items);

  return items;
}

// ─── Line-based fallback completions ──────────────────────────────────────
// Works even when the YAML AST is broken (which happens often while typing)

function fallbackCompletions(lines: string[], position: Position, items: CompletionItem[]): void {
  const line = lines[position.line] || '';
  const indent = line.search(/\S/);
  const trimmed = line.trimStart();
  const textBeforeCursor = line.substring(0, position.character);

  // If cursor is after "key: " (value position), only offer value completions
  const valueMatch = textBeforeCursor.match(/^\s*-?\s*([\w.]+)\s*:\s+/);
  if (valueMatch) {
    addValueCompletions(items, valueMatch[1], null);
    return;
  }

  // Extract the word being typed (prefix) for filtering
  const prefixMatch = textBeforeCursor.match(/(?:^|\s|-\s*)([\w.]*)$/);
  const prefix = prefixMatch ? prefixMatch[1] : '';

  // Determine context by scanning upward
  const context = detectContextFromLines(lines, position.line);

  switch (context.type) {
    case 'task-key': {
      // We're at a task level — offer task keywords + modules
      const existingKeys = context.existingKeys || [];
      addKeywordCompletions(items, taskKeywords, existingKeys);
      addModuleCompletions(items, existingKeys, prefix);
      break;
    }
    case 'module-option': {
      // We're inside a module's options
      const mod = modulesByFQCN.get(context.moduleName!) || modulesByShortName.get(context.moduleName!);
      if (mod) addModuleOptionCompletions(items, mod, context.existingKeys || []);
      break;
    }
    case 'play-key': {
      addKeywordCompletions(items, playKeywords, context.existingKeys || []);
      break;
    }
    case 'block-key': {
      addKeywordCompletions(items, blockKeywords, context.existingKeys || []);
      break;
    }
    default: {
      // Offer everything as a last resort
      addKeywordCompletions(items, taskKeywords, []);
      addModuleCompletions(items, [], prefix);
      break;
    }
  }
}

export interface LineContext {
  type: 'play-key' | 'task-key' | 'module-option' | 'block-key' | 'unknown';
  moduleName?: string;
  existingKeys?: string[];
}

const TASK_LIST_KEYS = new Set(['tasks', 'pre_tasks', 'post_tasks', 'handlers']);
const BLOCK_TASK_KEYS = new Set(['block', 'rescue', 'always']);

export function detectContextFromLines(lines: string[], lineNum: number): LineContext {
  const currentLine = lines[lineNum] || '';
  const currentIndent = currentLine.search(/\S/);
  const effectiveIndent = currentIndent === -1 ? currentLine.length : currentIndent;

  // Collect sibling keys at the same indent level
  const existingKeys: string[] = [];
  let moduleName: string | undefined;
  let parentKey: string | undefined;
  let parentIndent = -1;

  // Scan upward to find parent and siblings
  for (let i = lineNum - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.trim() === '' || l.trim().startsWith('#')) continue;

    const ind = l.search(/\S/);
    if (ind === -1) continue;

    // Same indent level — sibling key
    if (ind === effectiveIndent) {
      const keyMatch = l.match(/^\s*([\w.]+)\s*:/);
      if (keyMatch) existingKeys.push(keyMatch[1]);
      // List item start
      const listKeyMatch = l.match(/^\s*-\s*([\w.]+)\s*:/);
      if (listKeyMatch) existingKeys.push(listKeyMatch[1]);
      continue;
    }

    // Less indented — this is a parent
    if (ind < effectiveIndent) {
      const keyMatch = l.match(/^\s*-?\s*([\w.]+)\s*:/);
      if (keyMatch) {
        parentKey = keyMatch[1];
        parentIndent = ind;
      }
      break;
    }
  }

  // Also scan forward for siblings
  for (let i = lineNum + 1; i < Math.min(lines.length, lineNum + 30); i++) {
    const l = lines[i];
    if (l.trim() === '' || l.trim().startsWith('#')) continue;
    const ind = l.search(/\S/);
    if (ind < effectiveIndent) break;
    if (ind === effectiveIndent) {
      const keyMatch = l.match(/^\s*([\w.]+)\s*:/);
      if (keyMatch) existingKeys.push(keyMatch[1]);
      const listKeyMatch = l.match(/^\s*-\s*([\w.]+)\s*:/);
      if (listKeyMatch) existingKeys.push(listKeyMatch[1]);
    }
  }

  // Check if a module is already among siblings
  for (const key of existingKeys) {
    if (modulesByFQCN.has(key) || modulesByShortName.has(key)) {
      moduleName = key;
      break;
    }
  }

  // Is parent a module name? Then we're in module options
  if (parentKey && (modulesByFQCN.has(parentKey) || modulesByShortName.has(parentKey))) {
    return { type: 'module-option', moduleName: parentKey, existingKeys };
  }

  // Is parent a task list key? Then we're in a task
  if (parentKey && TASK_LIST_KEYS.has(parentKey)) {
    return { type: 'task-key', existingKeys, moduleName };
  }

  // Is parent a block key?
  if (parentKey && BLOCK_TASK_KEYS.has(parentKey)) {
    return { type: 'task-key', existingKeys, moduleName };
  }

  // Is parent "block"? Then we might be at block level
  if (existingKeys.includes('block')) {
    return { type: 'block-key', existingKeys };
  }

  // Are we at play level? (top-level or has hosts/tasks/roles)
  if (parentIndent === -1 || existingKeys.includes('hosts') || existingKeys.includes('tasks') || existingKeys.includes('roles')) {
    return { type: 'play-key', existingKeys };
  }

  // Scan further up to find if we're nested inside tasks
  for (let i = lineNum - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.trim() === '' || l.trim().startsWith('#')) continue;
    const ind = l.search(/\S/);
    if (ind === -1) continue;
    const keyMatch = l.match(/^\s*([\w.]+)\s*:\s*$/);
    if (keyMatch && TASK_LIST_KEYS.has(keyMatch[1])) {
      return { type: 'task-key', existingKeys, moduleName };
    }
    if (keyMatch && BLOCK_TASK_KEYS.has(keyMatch[1])) {
      return { type: 'task-key', existingKeys, moduleName };
    }
    if (ind === 0) break; // Reached top-level
  }

  return { type: 'task-key', existingKeys, moduleName };
}

// ─── Completion builders ──────────────────────────────────────────────────

function addKeywordCompletions(
  items: CompletionItem[],
  keywords: Record<string, any>,
  existingKeys: string[],
): void {
  const existing = new Set(existingKeys);
  for (const [key, def] of Object.entries(keywords)) {
    if (existing.has(key)) continue;
    items.push({
      label: key,
      kind: CompletionItemKind.Property,
      detail: `${def.type}${def.required ? ' (required)' : ''}`,
      documentation: def.description,
      sortText: def.required ? `0_${key}` : `1_${key}`,
      insertText: `${key}: `,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }
}

function addModuleCompletions(items: CompletionItem[], existingKeys: string[], prefix: string): void {
  const existing = new Set(existingKeys);
  // Check if a module is already present
  for (const key of existing) {
    if (modulesByFQCN.has(key) || modulesByShortName.has(key)) return;
  }

  const lowerPrefix = prefix.toLowerCase();

  for (const [fqcn, mod] of modulesByFQCN) {
    const shortName = fqcn.split('.').pop()!;
    // Pre-filter: only include modules where short name starts with prefix
    // or the typed text contains a dot (user is typing FQCN like "ansible.builtin.")
    if (lowerPrefix) {
      if (lowerPrefix.includes('.')) {
        if (!fqcn.toLowerCase().startsWith(lowerPrefix)) continue;
      } else {
        if (!shortName.toLowerCase().startsWith(lowerPrefix)) continue;
      }
    }
    // Prioritize ansible.builtin modules, then by collection name
    const priority = fqcn.startsWith('ansible.builtin.') ? '2a' : '2z';
    // Use short name as label so Zed matches against the typed word.
    // textEdit with explicit range ensures only the typed text is replaced,
    // preserving indentation.
    const displayLabel = lowerPrefix.includes('.') ? fqcn : shortName;
    items.push({
      label: displayLabel,
      kind: CompletionItemKind.Module,
      detail: `${fqcn} — ${mod.short_description}`,
      documentation: mod.description,
      sortText: `${priority}_${fqcn}`,
      insertText: `${fqcn}: `,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }
}

function addModuleOptionCompletions(
  items: CompletionItem[],
  mod: ModuleDefinition,
  existingKeys: string[],
): void {
  const existing = new Set(existingKeys);
  for (const [key, opt] of Object.entries(mod.options)) {
    if (existing.has(key)) continue;
    items.push({
      label: key,
      kind: CompletionItemKind.Property,
      detail: `${opt.type}${opt.required ? ' (required)' : ''}${opt.default != null ? ` [default: ${opt.default}]` : ''}`,
      documentation: opt.description,
      sortText: opt.required ? `0_${key}` : `1_${key}`,
      insertText: `${key}: `,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }
}

function addValueCompletions(items: CompletionItem[], key: string, parentContext: any): void {
  const boolKeys = new Set(['become', 'gather_facts', 'no_log', 'ignore_errors', 'run_once',
    'delegate_facts', 'check_mode', 'diff', 'any_errors_fatal', 'force_handlers',
    'ignore_unreachable']);
  if (boolKeys.has(key)) {
    items.push(
      { label: 'true', kind: CompletionItemKind.Value, sortText: '0_true' },
      { label: 'false', kind: CompletionItemKind.Value, sortText: '0_false' },
    );
    return;
  }

  if (parentContext?.type === 'module_options') {
    const mod = modulesByFQCN.get(parentContext.moduleName) || modulesByShortName.get(parentContext.moduleName);
    if (mod?.options[key]?.choices) {
      for (const choice of mod.options[key].choices!) {
        items.push({
          label: String(choice),
          kind: CompletionItemKind.EnumMember,
          sortText: `0_${choice}`,
        });
      }
    }
  }

  if (key === 'strategy') {
    for (const s of ['linear', 'free', 'debug']) {
      items.push({ label: s, kind: CompletionItemKind.Value });
    }
  }

  if (key === 'connection') {
    for (const c of ['ssh', 'local', 'winrm', 'paramiko', 'psrp']) {
      items.push({ label: c, kind: CompletionItemKind.Value });
    }
  }
}

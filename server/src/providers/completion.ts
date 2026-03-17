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
  const parsed = parseAnsibleDocument(doc.getText());
  const ctx = detectContext(parsed, position);
  const items: CompletionItem[] = [];

  switch (ctx.type) {
    case 'play':
      addKeywordCompletions(items, playKeywords, ctx.existingKeys);
      break;

    case 'task':
      addKeywordCompletions(items, taskKeywords, ctx.existingKeys);
      addModuleCompletions(items, ctx.existingKeys);
      break;

    case 'block':
      addKeywordCompletions(items, blockKeywords, ctx.existingKeys);
      break;

    case 'role_entry':
      addKeywordCompletions(items, roleKeywords, ctx.existingKeys);
      break;

    case 'module_options': {
      const mod = modulesByFQCN.get(ctx.moduleName) || modulesByShortName.get(ctx.moduleName);
      if (mod) {
        addModuleOptionCompletions(items, mod, ctx.existingKeys);
      }
      break;
    }

    case 'value': {
      addValueCompletions(items, ctx.key, ctx.parentContext);
      break;
    }
  }

  return items;
}

function addKeywordCompletions(
  items: CompletionItem[],
  keywords: Record<string, any>,
  existingKeys: string[]
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

function addModuleCompletions(items: CompletionItem[], existingKeys: string[]): void {
  const existing = new Set(existingKeys);
  // Check if a module is already present
  for (const key of existing) {
    if (modulesByFQCN.has(key) || modulesByShortName.has(key)) return;
  }

  for (const [fqcn, mod] of modulesByFQCN) {
    const shortName = fqcn.split('.').pop()!;
    items.push({
      label: fqcn,
      kind: CompletionItemKind.Module,
      detail: mod.short_description,
      documentation: mod.description,
      sortText: `2_${fqcn}`,
      filterText: `${fqcn} ${shortName}`,
      insertText: `${fqcn}:\n  `,
      insertTextFormat: InsertTextFormat.PlainText,
    });
  }
}

function addModuleOptionCompletions(
  items: CompletionItem[],
  mod: ModuleDefinition,
  existingKeys: string[]
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
  // Boolean keys
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

  // If in module_options context, check for choices
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

  // Strategy values
  if (key === 'strategy') {
    for (const s of ['linear', 'free', 'debug']) {
      items.push({ label: s, kind: CompletionItemKind.Value });
    }
  }

  // Connection values
  if (key === 'connection') {
    for (const c of ['ssh', 'local', 'winrm', 'paramiko', 'psrp']) {
      items.push({ label: c, kind: CompletionItemKind.Value });
    }
  }
}

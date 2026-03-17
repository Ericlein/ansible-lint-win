import { Hover, Position, MarkupKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseAnsibleDocument, positionToOffset, getKeyAtOffset } from '../parser/document';
import {
  modulesByFQCN, modulesByShortName, shortNameToFQCN,
  playKeywords, taskKeywords, blockKeywords, roleKeywords,
} from '../data/loader';
import { ModuleDefinition, ModuleOption } from '../data/keywords';

export function getHover(doc: TextDocument, position: Position): Hover | null {
  const text = doc.getText();
  const parsed = parseAnsibleDocument(text);
  const offset = positionToOffset(parsed.lines, position);

  // Get the word at cursor position
  const line = parsed.lines[position.line] || '';
  const word = getWordAt(line, position.character);
  if (!word) return null;

  // Check if it's a module name (FQCN or short)
  let mod = modulesByFQCN.get(word);
  if (mod) return moduleHover(mod);

  mod = modulesByShortName.get(word);
  if (mod) return moduleHover(mod, true);

  // Check keywords
  const keywordSets: [string, Record<string, any>][] = [
    ['play', playKeywords],
    ['task', taskKeywords],
    ['block', blockKeywords],
    ['role', roleKeywords],
  ];
  for (const [ctx, keywords] of keywordSets) {
    if (keywords[word]) {
      const kw = keywords[word];
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${word}** *(${ctx} keyword)*\n\n${kw.description}\n\nType: \`${kw.type}\`${kw.required ? ' **(required)**' : ''}`,
        },
      };
    }
  }

  // Check if it's a module option — look at the context
  // Try to find which module we're inside by scanning nearby lines
  const moduleName = findModuleFromContext(parsed.lines, position.line);
  if (moduleName) {
    const parentMod = modulesByFQCN.get(moduleName) || modulesByShortName.get(moduleName);
    if (parentMod?.options[word]) {
      return optionHover(word, parentMod.options[word], parentMod.fqcn);
    }
  }

  return null;
}

function getWordAt(line: string, col: number): string {
  // Expand from cursor to get the full word (including dots for FQCNs)
  let start = col;
  let end = col;
  while (start > 0 && /[\w.]/.test(line[start - 1])) start--;
  while (end < line.length && /[\w.]/.test(line[end])) end++;
  const word = line.slice(start, end).replace(/:$/, '');
  return word;
}

function moduleHover(mod: ModuleDefinition, isShortName = false): Hover {
  let md = `### ${mod.fqcn}\n\n`;

  if (isShortName) {
    md += `> **Note:** Use the fully qualified collection name \`${mod.fqcn}\`\n\n`;
  }
  if (mod.deprecated) {
    md += `> **Deprecated:** ${mod.deprecated}\n\n`;
  }

  md += `${mod.short_description}\n\n`;
  if (mod.description) md += `${mod.description}\n\n`;

  const opts = Object.entries(mod.options);
  if (opts.length > 0) {
    md += `| Option | Type | Required | Description |\n|--------|------|----------|-------------|\n`;
    // Required first
    const sorted = opts.sort(([, a], [, b]) => (b.required ? 1 : 0) - (a.required ? 1 : 0));
    for (const [name, opt] of sorted.slice(0, 20)) { // Cap at 20 to keep hover manageable
      const req = opt.required ? '**yes**' : 'no';
      const desc = opt.description.replace(/\|/g, '\\|').slice(0, 100);
      md += `| \`${name}\` | ${opt.type} | ${req} | ${desc} |\n`;
    }
    if (opts.length > 20) md += `\n*...and ${opts.length - 20} more options*\n`;
  }

  return { contents: { kind: MarkupKind.Markdown, value: md } };
}

function optionHover(name: string, opt: ModuleOption, moduleFqcn: string): Hover {
  let md = `**${name}** — *option of \`${moduleFqcn}\`*\n\n`;
  md += `${opt.description}\n\n`;
  md += `- **Type:** \`${opt.type}\`\n`;
  md += `- **Required:** ${opt.required ? 'yes' : 'no'}\n`;
  if (opt.default != null) md += `- **Default:** \`${opt.default}\`\n`;
  if (opt.choices) md += `- **Choices:** ${opt.choices.map(c => `\`${c}\``).join(', ')}\n`;
  if (opt.aliases) md += `- **Aliases:** ${opt.aliases.join(', ')}\n`;
  return { contents: { kind: MarkupKind.Markdown, value: md } };
}

/** Scan lines above to find the module name this option belongs to */
function findModuleFromContext(lines: string[], lineNum: number): string | null {
  const currentIndent = (lines[lineNum] || '').search(/\S/);
  for (let i = lineNum - 1; i >= Math.max(0, lineNum - 20); i--) {
    const line = lines[i];
    const indent = line.search(/\S/);
    if (indent < currentIndent && indent >= 0) {
      const match = line.match(/^\s*([\w.]+):\s*$/);
      if (match) {
        const key = match[1];
        if (modulesByFQCN.has(key) || modulesByShortName.has(key)) return key;
      }
      if (indent === 0) break;
    }
  }
  return null;
}

import { parseDocument, Document, YAMLMap, YAMLSeq, Pair, Scalar, Node, isMap, isSeq, isScalar, isPair } from 'yaml';
import { Position } from 'vscode-languageserver';

export interface ParsedDocument {
  doc: Document;
  text: string;
  lines: string[];
}

export function parseAnsibleDocument(text: string): ParsedDocument {
  const doc = parseDocument(text, { keepSourceTokens: true, strict: false });
  return {
    doc,
    text,
    lines: text.split('\n'),
  };
}

/** Get the offset in the text for a given line/character position */
export function positionToOffset(lines: string[], pos: Position): number {
  let offset = 0;
  for (let i = 0; i < pos.line && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }
  offset += Math.min(pos.character, (lines[pos.line] || '').length);
  return offset;
}

/** Convert offset back to line/character Position */
export function offsetToPosition(lines: string[], offset: number): Position {
  let remaining = offset;
  for (let line = 0; line < lines.length; line++) {
    if (remaining <= lines[line].length) {
      return { line, character: remaining };
    }
    remaining -= lines[line].length + 1;
  }
  return { line: lines.length - 1, character: (lines[lines.length - 1] || '').length };
}

/** Walk the YAML AST and return the path of nodes to the given offset */
export function getPathAtOffset(doc: Document, offset: number): Node[] {
  const path: Node[] = [];

  function walk(node: any): boolean {
    if (!node) return false;
    const range = node.range;
    if (range && (offset < range[0] || offset > range[1])) return false;

    path.push(node);

    if (isMap(node)) {
      for (const item of node.items) {
        if (walk(item)) return true;
      }
    } else if (isSeq(node)) {
      for (const item of node.items) {
        if (walk(item as any)) return true;
      }
    } else if (isPair(node)) {
      if (walk(node.value as any)) return true;
      if (walk(node.key as any)) return true;
    }
    return true;
  }

  if (doc.contents) walk(doc.contents);
  return path;
}

/** Get all string keys of a YAMLMap */
export function getMapKeys(map: YAMLMap): string[] {
  return map.items
    .map(pair => isScalar(pair.key) ? String(pair.key.value) : '')
    .filter(k => k !== '');
}

/** Find the YAMLMap that contains the cursor position */
export function getContainingMap(path: Node[]): YAMLMap | null {
  for (let i = path.length - 1; i >= 0; i--) {
    if (isMap(path[i])) return path[i] as YAMLMap;
  }
  return null;
}

/** Find the key name if the cursor is on a value position in a pair */
export function getCurrentKey(path: Node[]): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    if (isPair(path[i])) {
      const pair = path[i] as unknown as Pair;
      if (isScalar(pair.key)) return String(pair.key.value);
    }
  }
  return null;
}

/** Get the scalar value at cursor if hovering over a key */
export function getKeyAtOffset(doc: Document, offset: number): { key: string; map: YAMLMap } | null {
  const path = getPathAtOffset(doc, offset);
  for (let i = path.length - 1; i >= 0; i--) {
    if (isPair(path[i])) {
      const pair = path[i] as unknown as Pair;
      if (isScalar(pair.key)) {
        const keyNode = pair.key as Scalar;
        const range = keyNode.range;
        if (range && offset >= range[0] && offset <= range[1]) {
          // Find the parent map
          for (let j = i - 1; j >= 0; j--) {
            if (isMap(path[j])) {
              return { key: String(keyNode.value), map: path[j] as YAMLMap };
            }
          }
        }
      }
    }
  }
  return null;
}

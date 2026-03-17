import { Document, YAMLMap, YAMLSeq, isMap, isSeq, isScalar, isPair, Pair, Node } from 'yaml';
import { Position } from 'vscode-languageserver';
import { ParsedDocument, positionToOffset, getPathAtOffset, getMapKeys } from './document';
import { modulesByFQCN, modulesByShortName, taskKeywords } from '../data/loader';

export type AnsibleContext =
  | { type: 'play'; existingKeys: string[] }
  | { type: 'task'; existingKeys: string[]; moduleName?: string }
  | { type: 'module_options'; moduleName: string; existingKeys: string[] }
  | { type: 'block'; existingKeys: string[] }
  | { type: 'role_entry'; existingKeys: string[] }
  | { type: 'value'; key: string; parentContext: AnsibleContext }
  | { type: 'unknown' };

const TASK_LIST_KEYS = new Set(['tasks', 'pre_tasks', 'post_tasks', 'handlers']);
const BLOCK_TASK_KEYS = new Set(['block', 'rescue', 'always']);
const TASK_KEYWORD_SET = new Set(Object.keys(taskKeywords));

/** Determine the Ansible context at a given cursor position */
export function detectContext(parsed: ParsedDocument, position: Position): AnsibleContext {
  const offset = positionToOffset(parsed.lines, position);
  const doc = parsed.doc;

  if (!doc.contents) return { type: 'unknown' };

  // Simple line-based heuristic for when YAML parsing is broken
  const line = parsed.lines[position.line] || '';
  const trimmed = line.trimStart();
  const indent = line.length - trimmed.length;

  // Try to use the AST path
  const path = getPathAtOffset(doc, offset);

  // Walk up the path to determine context
  return analyzeContext(path, parsed, offset);
}

function analyzeContext(path: Node[], parsed: ParsedDocument, offset: number): AnsibleContext {
  // Find the innermost YAMLMap the cursor is in
  let currentMap: YAMLMap | null = null;
  let parentMap: YAMLMap | null = null;
  let parentKey: string | null = null;
  let grandparentKey: string | null = null;

  // Walk the path, tracking maps and their parent keys
  const maps: { map: YAMLMap; parentKey: string | null }[] = [];

  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    if (isMap(node)) {
      let key: string | null = null;
      // Look back to find the pair that contains this map
      for (let j = i - 1; j >= 0; j--) {
        if (isPair(path[j])) {
          const pair = path[j] as unknown as Pair;
          if (isScalar(pair.key)) {
            key = String(pair.key.value);
          }
          break;
        }
      }
      maps.push({ map: node as YAMLMap, parentKey: key });
    }
  }

  if (maps.length === 0) {
    // We might be at the top-level sequence → play context
    return { type: 'play', existingKeys: [] };
  }

  currentMap = maps[maps.length - 1].map;
  parentKey = maps[maps.length - 1].parentKey;
  const existingKeys = getMapKeys(currentMap);

  if (maps.length >= 2) {
    parentMap = maps[maps.length - 2].map;
    grandparentKey = maps[maps.length - 2].parentKey;
  }

  // Check if we're on a value position (cursor is after a key's colon)
  const currentPairKey = findCurrentPairKey(path, offset);
  if (currentPairKey && isOnValueSide(path, offset)) {
    const ctx = determineMapContext(maps);
    return { type: 'value', key: currentPairKey, parentContext: ctx };
  }

  return determineMapContext(maps);
}

function determineMapContext(maps: { map: YAMLMap; parentKey: string | null }[]): AnsibleContext {
  if (maps.length === 0) return { type: 'play', existingKeys: [] };

  const current = maps[maps.length - 1];
  const existingKeys = getMapKeys(current.map);
  const parentKey = current.parentKey;

  // Is this map inside a task list key?
  if (parentKey && TASK_LIST_KEYS.has(parentKey)) {
    const moduleName = findModuleInKeys(existingKeys);
    return { type: 'task', existingKeys, moduleName: moduleName || undefined };
  }

  // Is this map inside a block/rescue/always?
  if (parentKey && BLOCK_TASK_KEYS.has(parentKey)) {
    const moduleName = findModuleInKeys(existingKeys);
    return { type: 'task', existingKeys, moduleName: moduleName || undefined };
  }

  // Is this map a module_options level? (parent key is a module name)
  if (parentKey && (modulesByFQCN.has(parentKey) || modulesByShortName.has(parentKey))) {
    return { type: 'module_options', moduleName: parentKey, existingKeys };
  }

  // Is this inside roles?
  if (parentKey === 'roles') {
    return { type: 'role_entry', existingKeys };
  }

  // Is this a block? (has 'block' key)
  if (existingKeys.includes('block')) {
    return { type: 'block', existingKeys };
  }

  // Top-level map in a sequence → play or task?
  // Check if any key matches a module name → it's a task
  const moduleName = findModuleInKeys(existingKeys);
  if (moduleName) {
    return { type: 'task', existingKeys, moduleName };
  }

  // If the map has typical play keys, it's a play
  if (existingKeys.includes('hosts') || existingKeys.includes('roles') ||
      existingKeys.includes('tasks') || existingKeys.includes('pre_tasks')) {
    return { type: 'play', existingKeys };
  }

  // Check grandparent context to decide
  if (maps.length >= 2) {
    const grandparent = maps[maps.length - 2];
    const gpKeys = getMapKeys(grandparent.map);
    const gpParentKey = grandparent.parentKey;

    if (gpParentKey && TASK_LIST_KEYS.has(gpParentKey)) {
      return { type: 'task', existingKeys, moduleName: moduleName || undefined };
    }
    if (gpParentKey && BLOCK_TASK_KEYS.has(gpParentKey)) {
      return { type: 'task', existingKeys, moduleName: moduleName || undefined };
    }
  }

  // Default: if at depth 1 in document, likely a play
  if (maps.length === 1) {
    return { type: 'play', existingKeys };
  }

  return { type: 'task', existingKeys };
}

function findModuleInKeys(keys: string[]): string | null {
  for (const key of keys) {
    if (modulesByFQCN.has(key) || modulesByShortName.has(key)) {
      return key;
    }
    // Skip known task keywords
    if (TASK_KEYWORD_SET.has(key)) continue;
  }
  return null;
}

function findCurrentPairKey(path: Node[], offset: number): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    if (isPair(path[i])) {
      const pair = path[i] as unknown as Pair;
      if (isScalar(pair.key)) return String(pair.key.value);
    }
  }
  return null;
}

function isOnValueSide(path: Node[], offset: number): boolean {
  for (let i = path.length - 1; i >= 0; i--) {
    if (isPair(path[i])) {
      const pair = path[i] as unknown as Pair;
      if (isScalar(pair.key)) {
        const keyRange = (pair.key as any).range;
        if (keyRange && offset > keyRange[1]) return true;
      }
      return false;
    }
  }
  return false;
}

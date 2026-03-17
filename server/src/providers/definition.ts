import { Definition, Location, Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as path from 'path';
import * as fs from 'fs';

const FILE_REF_KEYS = new Set([
  'include_tasks', 'import_tasks', 'include_vars',
  'ansible.builtin.include_tasks', 'ansible.builtin.import_tasks',
  'ansible.builtin.include_vars',
]);

export function getDefinition(doc: TextDocument, position: Position, workspaceRoot: string): Definition | null {
  const lines = doc.getText().split('\n');
  const line = lines[position.line] || '';

  // Match patterns like "include_tasks: path/to/file.yml"
  const kvMatch = line.match(/^\s*([\w.]+):\s*(.+?)\s*$/);
  if (!kvMatch) return null;

  const key = kvMatch[1];
  const value = kvMatch[2];

  // File reference keys
  if (FILE_REF_KEYS.has(key)) {
    return resolveFilePath(value, doc.uri, workspaceRoot);
  }

  // vars_files entries (list items)
  const listItemMatch = line.match(/^\s*-\s+(.+\.ya?ml)\s*$/);
  if (listItemMatch) {
    // Check if parent is vars_files
    for (let i = position.line - 1; i >= Math.max(0, position.line - 10); i--) {
      if (/^\s*vars_files:\s*$/.test(lines[i])) {
        return resolveFilePath(listItemMatch[1], doc.uri, workspaceRoot);
      }
      if (/^\S/.test(lines[i])) break;
    }
  }

  // Role references: "role: my_role" or "- my_role" under roles:
  if (key === 'role' || key === 'name') {
    // Check if context is roles or include_role
    for (let i = position.line - 1; i >= Math.max(0, position.line - 10); i--) {
      if (/^\s*roles:\s*$/.test(lines[i]) || /include_role/.test(lines[i])) {
        return resolveRolePath(value, workspaceRoot);
      }
      if (/^\S/.test(lines[i])) break;
    }
  }

  // Template/copy src
  if (key === 'src') {
    return resolveFilePath(value, doc.uri, workspaceRoot);
  }

  return null;
}

function resolveFilePath(filePath: string, docUri: string, workspaceRoot: string): Location | null {
  const docDir = path.dirname(docUri.replace('file:///', '').replace('file://', ''));
  const candidates = [
    path.resolve(docDir, filePath),
    path.resolve(workspaceRoot, filePath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return Location.create(
        `file:///${candidate.replace(/\\/g, '/')}`,
        Range.create(0, 0, 0, 0)
      );
    }
  }
  return null;
}

function resolveRolePath(roleName: string, workspaceRoot: string): Location | null {
  const candidates = [
    path.join(workspaceRoot, 'roles', roleName, 'tasks', 'main.yml'),
    path.join(workspaceRoot, 'roles', roleName, 'tasks', 'main.yaml'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return Location.create(
        `file:///${candidate.replace(/\\/g, '/')}`,
        Range.create(0, 0, 0, 0)
      );
    }
  }
  return null;
}

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { getCompletions, detectContextFromLines } from './completion';
import { loadData, modulesByFQCN } from '../data/loader';
import { TextDocument } from 'vscode-languageserver-textdocument';

beforeAll(() => {
  const dataDir = path.resolve(__dirname, '..', '..', 'data');
  loadData(dataDir);
  if (modulesByFQCN.size === 0) throw new Error('No modules loaded');
});

function makeDoc(content: string): TextDocument {
  return TextDocument.create('file:///test.yml', 'ansible', 1, content);
}

function getItems(content: string, line: number, character: number) {
  return getCompletions(makeDoc(content), { line, character });
}

function getLabels(content: string, line: number, character: number): string[] {
  return getItems(content, line, character).map(i => i.label);
}

function getItem(content: string, line: number, character: number, label: string) {
  return getItems(content, line, character).find(i => i.label === label);
}

// ─── Context Detection ──────────────────────────────────────────────────

describe('detectContextFromLines', () => {
  it('detects task-level context inside tasks:', () => {
    const lines = ['- hosts: all', '  tasks:', '    - name: test', '      '];
    expect(detectContextFromLines(lines, 3).type).toBe('task-key');
  });

  it('detects module-option context inside a module', () => {
    const lines = ['- hosts: all', '  tasks:', '    - name: test', '      ansible.builtin.copy:', '        '];
    const ctx = detectContextFromLines(lines, 4);
    expect(ctx.type).toBe('module-option');
    expect(ctx.moduleName).toBe('ansible.builtin.copy');
  });

  it('detects module-option with existing options as siblings', () => {
    const lines = ['- hosts: all', '  tasks:', '    - name: test', '      ansible.builtin.copy:', '        dest: /tmp/file', '        '];
    const ctx = detectContextFromLines(lines, 5);
    expect(ctx.type).toBe('module-option');
    expect(ctx.existingKeys).toContain('dest');
  });
});

// ─── Value Position Suppression ─────────────────────────────────────────

describe('value position suppression', () => {
  it('does not offer keywords after "name: "', () => {
    const labels = getLabels('- hosts: all\n  tasks:\n    - name: ', 2, 12);
    expect(labels).not.toContain('become');
  });

  it('offers true/false after "become: "', () => {
    const labels = getLabels('- hosts: all\n  tasks:\n    - name: test\n      become: ', 3, 14);
    expect(labels).toContain('true');
    expect(labels).toContain('false');
    expect(labels).not.toContain('name');
  });
});

// ─── Module Completion: Label & InsertText ───────────────────────────────

describe('module completion format', () => {
  it('typing "copy" → label is "copy", insertText is FQCN', () => {
    const item = getItem('- hosts: all\n  tasks:\n    - name: test\n      copy', 3, 10, 'copy');
    expect(item).toBeDefined();
    expect(item!.label).toBe('copy');
    expect(item!.insertText).toBe('ansible.builtin.copy: ');
    expect(item!.detail).toContain('ansible.builtin.copy');
  });

  it('typing "copy" does not return label "ansible.builtin.copy"', () => {
    const labels = getLabels('- hosts: all\n  tasks:\n    - name: test\n      copy', 3, 10);
    expect(labels).not.toContain('ansible.builtin.copy');
    expect(labels).toContain('copy');
  });

  it('typing "ansible.builtin." → label is FQCN', () => {
    const labels = getLabels('- hosts: all\n  tasks:\n    - name: test\n      ansible.builtin.', 3, 23);
    const moduleLabels = labels.filter(l => l.startsWith('ansible.builtin.'));
    expect(moduleLabels.length).toBeGreaterThan(0);
  });

  it('ansible.builtin modules sort before other collections', () => {
    const items = getItems('- hosts: all\n  tasks:\n    - name: test\n      copy', 3, 10);
    const builtinCopy = items.find(i => i.detail?.includes('ansible.builtin.copy'));
    expect(builtinCopy).toBeDefined();
    expect(builtinCopy!.sortText!.startsWith('2a')).toBe(true);
  });

  it('insertText has no newline character', () => {
    const item = getItem('- hosts: all\n  tasks:\n    - name: test\n      copy', 3, 10, 'copy');
    expect(item!.insertText).not.toContain('\n');
  });
});

// ─── Module Completion Filtering ────────────────────────────────────────

describe('module completion filtering', () => {
  it('typing "copy" only returns modules whose short name starts with "copy"', () => {
    const items = getItems('- hosts: all\n  tasks:\n    - name: test\n      copy', 3, 10);
    const moduleItems = items.filter(i => i.kind === 9);
    expect(moduleItems.length).toBeGreaterThan(0);
    for (const item of moduleItems) {
      const fqcn = item.insertText!.replace(': ', '');
      const shortName = fqcn.split('.').pop()!;
      expect(shortName.toLowerCase().startsWith('copy')).toBe(true);
    }
  });

  it('typing "file" returns modules starting with "file"', () => {
    const items = getItems('- hosts: all\n  tasks:\n    - name: test\n      file', 3, 10);
    const moduleItems = items.filter(i => i.kind === 9);
    expect(moduleItems.some(i => i.insertText?.includes('ansible.builtin.file'))).toBe(true);
  });

  it('empty prefix returns keywords and modules', () => {
    const labels = getLabels('- hosts: all\n  tasks:\n    - name: test\n      ', 3, 6);
    expect(labels).toContain('become');
    expect(labels.length).toBeGreaterThan(30);
  });
});

// ─── Module Option Completions ──────────────────────────────────────────

describe('module option completions', () => {
  it('offers options under ansible.builtin.copy', () => {
    const labels = getLabels('- hosts: all\n  tasks:\n    - name: test\n      ansible.builtin.copy:\n        ', 4, 8);
    expect(labels).toContain('dest');
    expect(labels).toContain('src');
    expect(labels).toContain('content');
    expect(labels).toContain('mode');
    expect(labels).not.toContain('become');
    expect(labels).not.toContain('name');
  });

  it('excludes already-written options', () => {
    const labels = getLabels('- hosts: all\n  tasks:\n    - name: test\n      ansible.builtin.copy:\n        dest: /tmp\n        ', 5, 8);
    expect(labels).toContain('src');
    expect(labels).not.toContain('dest');
  });

  it('option insertText is "key: "', () => {
    const item = getItem('- hosts: all\n  tasks:\n    - name: test\n      ansible.builtin.copy:\n        ', 4, 8, 'dest');
    expect(item!.insertText).toBe('dest: ');
  });
});

// ─── Keyword Completions ────────────────────────────────────────────────

describe('keyword completions', () => {
  it('does not re-offer existing sibling keys', () => {
    const labels = getLabels('- hosts: all\n  tasks:\n    - name: test\n      become: true\n      ', 4, 6);
    expect(labels).not.toContain('become');
  });

  it('keyword insertText is "key: "', () => {
    const item = getItem('- hosts: all\n  tasks:\n    - name: test\n      ', 3, 6, 'become');
    expect(item!.insertText).toBe('become: ');
  });
});

// ─── Full User Workflow ─────────────────────────────────────────────────

describe('full user workflow', () => {
  it('step 1: type "copy" → insertText is FQCN with colon', () => {
    const content = '- name: string\n  copy';
    const item = getItem(content, 1, 6, 'copy');
    expect(item).toBeDefined();
    expect(item!.label).toBe('copy');
    expect(item!.insertText).toBe('ansible.builtin.copy: ');
  });

  it('step 2: after module, options on indented line', () => {
    const content = '- name: string\n  ansible.builtin.copy:\n    ';
    const labels = getLabels(content, 2, 4);
    expect(labels).toContain('dest');
    expect(labels).toContain('src');
    expect(labels).not.toContain('become');
  });

  it('step 3: after dest written, remaining options available', () => {
    const content = '- name: string\n  ansible.builtin.copy:\n    dest: /tmp\n    ';
    const labels = getLabels(content, 3, 4);
    expect(labels).toContain('src');
    expect(labels).not.toContain('dest');
  });

  it('step 4: next task gets fresh completions', () => {
    const content = '- hosts: all\n  tasks:\n    - name: first\n      ansible.builtin.copy:\n        dest: /tmp\n    - name: second\n      ';
    const labels = getLabels(content, 6, 6);
    expect(labels).toContain('become');
    const moduleItems = getItems(content, 6, 6).filter(i => i.kind === 9);
    expect(moduleItems.length).toBeGreaterThan(0);
  });
});

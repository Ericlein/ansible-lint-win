import * as fs from 'fs';
import * as path from 'path';
import { ModuleDefinition, KeywordDefinition } from './keywords';

export const modulesByFQCN = new Map<string, ModuleDefinition>();
export const modulesByShortName = new Map<string, ModuleDefinition>();
export const shortNameToFQCN: Record<string, string> = {};

export let playKeywords: Record<string, KeywordDefinition> = {};
export let taskKeywords: Record<string, KeywordDefinition> = {};
export let blockKeywords: Record<string, KeywordDefinition> = {};
export let roleKeywords: Record<string, KeywordDefinition> = {};

export function loadData(dataDir: string): void {
  // Load keyword files
  playKeywords = readJson(path.join(dataDir, 'keywords', 'play.json'));
  taskKeywords = readJson(path.join(dataDir, 'keywords', 'task.json'));
  blockKeywords = readJson(path.join(dataDir, 'keywords', 'block.json'));
  roleKeywords = readJson(path.join(dataDir, 'keywords', 'role.json'));

  // Load deprecated/short-name mapping
  const deprecated = readJson(path.join(dataDir, 'deprecated.json'));
  Object.assign(shortNameToFQCN, deprecated);

  // Load module data files
  const modulesDir = path.join(dataDir, 'modules');
  if (!fs.existsSync(modulesDir)) return;

  for (const file of fs.readdirSync(modulesDir)) {
    if (!file.endsWith('.json')) continue;
    const modules: Record<string, any> = readJson(path.join(modulesDir, file));
    for (const [fqcn, mod] of Object.entries(modules)) {
      const def: ModuleDefinition = {
        fqcn,
        short_description: mod.short_description || '',
        description: mod.description || '',
        options: mod.options || {},
        deprecated: mod.deprecated || null,
      };
      modulesByFQCN.set(fqcn, def);
      const shortName = fqcn.split('.').pop()!;
      modulesByShortName.set(shortName, def);
    }
  }
}

function readJson(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

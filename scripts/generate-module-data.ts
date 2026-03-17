/**
 * Fetches Ansible module documentation from GitHub and generates JSON data files.
 *
 * Collections are defined as a simple array — add or remove entries to support
 * any collection. No GitHub token required for public repos, but set
 * GITHUB_TOKEN env var to avoid rate limits.
 *
 * Usage: npx tsx scripts/generate-module-data.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';

// ─── Collection definitions ────────────────────────────────────────────────
// Add any collection here. `repo` is the GitHub owner/repo, `modulesPath` is
// the path within the repo to the modules directory.

interface CollectionDef {
  namespace: string;        // e.g. "ansible.builtin"
  repo: string;             // e.g. "ansible/ansible"
  modulesPath: string;      // e.g. "lib/ansible/modules"
}

const COLLECTIONS: CollectionDef[] = [
  {
    namespace: 'ansible.builtin',
    repo: 'ansible/ansible',
    modulesPath: 'lib/ansible/modules',
  },
  {
    namespace: 'community.general',
    repo: 'ansible-collections/community.general',
    modulesPath: 'plugins/modules',
  },
  {
    namespace: 'ansible.windows',
    repo: 'ansible-collections/ansible.windows',
    modulesPath: 'plugins/modules',
  },
  {
    namespace: 'community.mysql',
    repo: 'ansible-collections/community.mysql',
    modulesPath: 'plugins/modules',
  },
  {
    namespace: 'community.hashi_vault',
    repo: 'ansible-collections/community.hashi_vault',
    modulesPath: 'plugins/modules',
  },
];

// ─── GitHub helpers ────────────────────────────────────────────────────────

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const headers: Record<string, string> = {
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'ansible-ls-lite-datagen',
};
if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

async function ghFetch(url: string): Promise<any> {
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const waitSec = reset ? Math.max(0, Number(reset) - Math.floor(Date.now() / 1000)) : 60;
    console.error(`Rate limited. Resets in ${waitSec}s. Set GITHUB_TOKEN to avoid this.`);
    process.exit(1);
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`);
  return res.json();
}

async function ghRaw(repo: string, branch: string, filePath: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ansible-ls-lite-datagen' } });
  if (!res.ok) throw new Error(`Raw fetch ${res.status}: ${url}`);
  return res.text();
}

// ─── Module doc extraction ─────────────────────────────────────────────────

const DOC_RE = /DOCUMENTATION\s*=\s*r?(?:'''|"""|'|")([\s\S]+?)(?:'''|"""|'|")/;

interface ModuleData {
  short_description: string;
  description: string;
  options: Record<string, any>;
  deprecated: string | null;
}

function extractDocumentation(source: string): ModuleData | null {
  const match = source.match(DOC_RE);
  if (!match) return null;

  let yamlText = match[1];
  // Some modules use C() or I() markup — strip for cleaner descriptions
  try {
    const doc = parseYaml(yamlText, { strict: false });
    if (!doc || typeof doc !== 'object') return null;

    const options: Record<string, any> = {};
    if (doc.options && typeof doc.options === 'object') {
      for (const [key, val] of Object.entries(doc.options as Record<string, any>)) {
        if (!val || typeof val !== 'object') continue;
        const desc = Array.isArray(val.description)
          ? val.description.join(' ')
          : (val.description || '');
        options[key] = {
          description: desc,
          type: val.type || 'str',
          required: val.required === true,
          choices: val.choices || null,
          default: val.default ?? null,
          aliases: val.aliases || null,
        };
      }
    }

    const desc = Array.isArray(doc.description)
      ? doc.description.join(' ')
      : (doc.description || '');

    let deprecated: string | null = null;
    if (doc.deprecated) {
      deprecated = typeof doc.deprecated === 'object'
        ? (doc.deprecated.why || doc.deprecated.removed_in || 'deprecated')
        : String(doc.deprecated);
    }

    return {
      short_description: doc.short_description || '',
      description: desc,
      options,
      deprecated,
    };
  } catch (e) {
    return null;
  }
}

// ─── List module files via GitHub API (handles pagination + subdirs) ───────

async function listModuleFiles(repo: string, modulesPath: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [modulesPath];

  while (queue.length > 0) {
    const dirPath = queue.shift()!;
    const url = `https://api.github.com/repos/${repo}/contents/${dirPath}`;
    let items: any[];
    try {
      items = await ghFetch(url);
    } catch (e) {
      console.error(`  Failed to list ${dirPath}: ${e}`);
      continue;
    }

    if (!Array.isArray(items)) continue;

    for (const item of items) {
      if (item.type === 'dir') {
        queue.push(item.path);
      } else if (item.type === 'file' && item.name.endsWith('.py') && !item.name.startsWith('_') && item.name !== '__init__.py') {
        files.push(item.path);
      }
    }
  }
  return files;
}

// ─── Default branch detection ──────────────────────────────────────────────

async function getDefaultBranch(repo: string): Promise<string> {
  const data = await ghFetch(`https://api.github.com/repos/${repo}`);
  return data.default_branch || 'main';
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function processCollection(col: CollectionDef): Promise<Record<string, ModuleData>> {
  console.log(`\n── ${col.namespace} (${col.repo}) ──`);
  const branch = await getDefaultBranch(col.repo);
  console.log(`  Branch: ${branch}`);

  const pyFiles = await listModuleFiles(col.repo, col.modulesPath);
  console.log(`  Found ${pyFiles.length} module files`);

  const modules: Record<string, ModuleData> = {};
  let processed = 0;

  // Process in batches to avoid hammering GitHub
  const BATCH = 10;
  for (let i = 0; i < pyFiles.length; i += BATCH) {
    const batch = pyFiles.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (filePath) => {
        const moduleName = path.basename(filePath, '.py');
        try {
          const source = await ghRaw(col.repo, branch, filePath);
          const doc = extractDocumentation(source);
          return { moduleName, doc };
        } catch (e) {
          return { moduleName, doc: null };
        }
      })
    );

    for (const { moduleName, doc } of results) {
      if (doc) {
        const fqcn = `${col.namespace}.${moduleName}`;
        modules[fqcn] = doc;
      }
      processed++;
    }

    if (processed % 50 === 0 || processed === pyFiles.length) {
      console.log(`  Processed ${processed}/${pyFiles.length}`);
    }
  }

  return modules;
}

async function main() {
  const outDir = path.resolve(__dirname, '..', 'server', 'data', 'modules');
  fs.mkdirSync(outDir, { recursive: true });

  for (const col of COLLECTIONS) {
    try {
      const modules = await processCollection(col);
      const outFile = path.join(outDir, `${col.namespace}.json`);
      fs.writeFileSync(outFile, JSON.stringify(modules, null, 2));
      console.log(`  Wrote ${Object.keys(modules).length} modules → ${outFile}`);
    } catch (e) {
      console.error(`  FAILED: ${col.namespace}: ${e}`);
    }
  }

  console.log('\nDone!');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

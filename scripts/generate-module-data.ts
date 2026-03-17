/**
 * Fetches Ansible module documentation from GitHub and generates JSON data files.
 *
 * By default, auto-discovers ALL collections from the ansible-collections
 * GitHub org, plus ansible.builtin from ansible/ansible. You can also pass
 * specific collection names as CLI args to only fetch those.
 *
 * Usage:
 *   npx tsx scripts/generate-module-data.ts               # all collections
 *   npx tsx scripts/generate-module-data.ts community.general ansible.windows  # specific ones
 *
 * Set GITHUB_TOKEN to avoid rate limits (required for fetching all collections):
 *   GITHUB_TOKEN=ghp_xxx npx tsx scripts/generate-module-data.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';

// ─── Types ─────────────────────────────────────────────────────────────────

interface CollectionDef {
  namespace: string;
  repo: string;
  modulesPath: string;
}

interface ModuleData {
  short_description: string;
  description: string;
  options: Record<string, any>;
  deprecated: string | null;
}

// ─── GitHub helpers ────────────────────────────────────────────────────────

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const headers: Record<string, string> = {
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'ansible-ls-lite-datagen',
};
if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

let apiCalls = 0;

async function ghFetch(url: string): Promise<any> {
  apiCalls++;
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const remaining = res.headers.get('x-ratelimit-remaining');
    const waitSec = reset ? Math.max(0, Number(reset) - Math.floor(Date.now() / 1000)) : 60;
    console.error(`\nRate limited after ${apiCalls} API calls. Resets in ${waitSec}s.`);
    console.error(`Set GITHUB_TOKEN env var to get 5000 req/hr instead of 60.`);
    process.exit(1);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`);
  return res.json();
}

/** Fetch all pages of a paginated GitHub API endpoint */
async function ghFetchAll(url: string): Promise<any[]> {
  const results: any[] = [];
  let nextUrl: string | null = url + (url.includes('?') ? '&' : '?') + 'per_page=100';

  while (nextUrl) {
    apiCalls++;
    const res = await fetch(nextUrl, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${nextUrl}`);
    const data = await res.json();
    if (Array.isArray(data)) results.push(...data);

    // Parse Link header for next page
    const link = res.headers.get('link') || '';
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = nextMatch ? nextMatch[1] : null;
  }

  return results;
}

async function ghRaw(repo: string, branch: string, filePath: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ansible-ls-lite-datagen' } });
  if (!res.ok) throw new Error(`Raw fetch ${res.status}: ${url}`);
  return res.text();
}

// ─── Auto-discover collections from GitHub ─────────────────────────────────

/**
 * Collections hosted outside the ansible-collections org.
 * These are added alongside auto-discovered ones.
 */
const EXTRA_COLLECTIONS: CollectionDef[] = [
  // Cloud providers
  { namespace: 'azure.azcollection', repo: 'ansible-collections/azure', modulesPath: 'plugins/modules' },
  { namespace: 'openstack.cloud', repo: 'openstack/ansible-collections-openstack', modulesPath: 'plugins/modules' },
  { namespace: 'vultr.cloud', repo: 'vultr/ansible-collection-vultr', modulesPath: 'plugins/modules' },
  { namespace: 'cloudscale_ch.cloud', repo: 'cloudscale-ch/ansible-collection-cloudscale', modulesPath: 'plugins/modules' },

  // Containers / Kubernetes
  { namespace: 'containers.podman', repo: 'containers/ansible-podman-collections', modulesPath: 'plugins/modules' },
  { namespace: 'community.okd', repo: 'openshift/community.okd', modulesPath: 'plugins/modules' },
  { namespace: 'kubevirt.core', repo: 'kubevirt/kubevirt.core', modulesPath: 'plugins/modules' },

  // Automation platforms
  { namespace: 'awx.awx', repo: 'ansible/awx', modulesPath: 'awx_collection/plugins/modules' },
  { namespace: 'theforeman.foreman', repo: 'theforeman/foreman-ansible-modules', modulesPath: 'plugins/modules' },
  { namespace: 'grafana.grafana', repo: 'grafana/grafana-ansible-collection', modulesPath: 'plugins/modules' },

  // Network / Security
  { namespace: 'f5networks.f5_modules', repo: 'F5Networks/f5-ansible', modulesPath: 'ansible_collections/f5networks/f5_modules/plugins/modules' },
  { namespace: 'fortinet.fortios', repo: 'fortinet-ansible-dev/ansible-galaxy-fortios-collection', modulesPath: 'plugins/modules' },
  { namespace: 'fortinet.fortimanager', repo: 'fortinet-ansible-dev/ansible-galaxy-fortimanager-collection', modulesPath: 'plugins/modules' },
  { namespace: 'check_point.mgmt', repo: 'CheckPointSW/CheckPointAnsibleMgmtCollection', modulesPath: 'plugins/modules' },
  { namespace: 'infoblox.nios_modules', repo: 'infobloxopen/infoblox-ansible', modulesPath: 'plugins/modules' },
  { namespace: 'netbox.netbox', repo: 'netbox-community/ansible_modules', modulesPath: 'plugins/modules' },
  { namespace: 'vyos.vyos', repo: 'vyos/vyos.vyos', modulesPath: 'plugins/modules' },

  // Cisco (outside ansible-collections org)
  { namespace: 'cisco.aci', repo: 'CiscoDevNet/ansible-aci', modulesPath: 'plugins/modules' },
  { namespace: 'cisco.dnac', repo: 'cisco-en-programmability/dnacenter-ansible', modulesPath: 'plugins/modules' },
  { namespace: 'cisco.intersight', repo: 'CiscoDevNet/intersight-ansible', modulesPath: 'plugins/modules' },
  { namespace: 'cisco.meraki', repo: 'meraki/dashboard-api-ansible', modulesPath: 'plugins/modules' },
  { namespace: 'cisco.mso', repo: 'CiscoDevNet/ansible-mso', modulesPath: 'plugins/modules' },
  { namespace: 'cisco.ucs', repo: 'CiscoDevNet/ansible-ucs', modulesPath: 'plugins/modules' },

  // Dell EMC (outside ansible-collections org)
  { namespace: 'dellemc.openmanage', repo: 'dell/dellemc-openmanage-ansible-modules', modulesPath: 'plugins/modules' },
  { namespace: 'dellemc.powerflex', repo: 'dell/ansible-powerflex', modulesPath: 'plugins/modules' },
  { namespace: 'dellemc.unity', repo: 'dell/ansible-unity', modulesPath: 'plugins/modules' },

  // Storage
  { namespace: 'purestorage.flasharray', repo: 'Pure-Storage-Ansible/FlashArray-Collection', modulesPath: 'plugins/modules' },
  { namespace: 'purestorage.flashblade', repo: 'Pure-Storage-Ansible/FlashBlade-Collection', modulesPath: 'plugins/modules' },

  // Secrets / Identity
  { namespace: 'cyberark.conjur', repo: 'cyberark/ansible-conjur-collection', modulesPath: 'plugins/modules' },
  { namespace: 'cyberark.pas', repo: 'cyberark/pas-orchestrator', modulesPath: 'plugins/modules' },

  // Virtualization
  { namespace: 'ovirt.ovirt', repo: 'oVirt/ovirt-ansible-collection', modulesPath: 'plugins/modules' },

  // Windows
  { namespace: 'chocolatey.chocolatey', repo: 'chocolatey/chocolatey-ansible', modulesPath: 'plugins/modules' },

  // Database
  { namespace: 'lowlydba.sqlserver', repo: 'lowlydba/lowlydba.sqlserver', modulesPath: 'plugins/modules' },
];

async function discoverCollections(): Promise<CollectionDef[]> {
  console.log('Discovering collections from ansible-collections org...');

  const repos = await ghFetchAll('https://api.github.com/orgs/ansible-collections/repos');
  console.log(`  Found ${repos.length} repos in ansible-collections org`);

  const collectionRepos = repos.filter((r: any) =>
    r.name.includes('.') && !r.archived && !r.disabled
  );
  console.log(`  ${collectionRepos.length} appear to be active collections`);

  const collections: CollectionDef[] = [
    {
      namespace: 'ansible.builtin',
      repo: 'ansible/ansible',
      modulesPath: 'lib/ansible/modules',
    },
  ];

  const seen = new Set<string>(['ansible.builtin']);

  for (const repo of collectionRepos) {
    if (!seen.has(repo.name)) {
      seen.add(repo.name);
      collections.push({
        namespace: repo.name,
        repo: `ansible-collections/${repo.name}`,
        modulesPath: 'plugins/modules',
      });
    }
  }

  // Add extra collections hosted outside the ansible-collections org
  for (const extra of EXTRA_COLLECTIONS) {
    if (!seen.has(extra.namespace)) {
      seen.add(extra.namespace);
      collections.push(extra);
    }
  }

  console.log(`  ${collections.length} total collections (${EXTRA_COLLECTIONS.length} extra from other orgs)`);
  return collections;
}

// ─── Module doc extraction ─────────────────────────────────────────────────

const DOC_RE = /DOCUMENTATION\s*=\s*r?(?:'''|"""|'|")([\s\S]+?)(?:'''|"""|'|")/;

function extractDocumentation(source: string): ModuleData | null {
  const match = source.match(DOC_RE);
  if (!match) return null;

  const yamlText = match[1];
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

// ─── Extract docs from standalone YAML doc files ──────────────────────────

function extractYamlDocumentation(yamlSource: string): ModuleData | null {
  try {
    const doc = parseYaml(yamlSource, { strict: false });
    if (!doc || typeof doc !== 'object') return null;

    // Some YAML doc files wrap content under DOCUMENTATION key
    const root = doc.DOCUMENTATION || doc;
    if (!root || typeof root !== 'object') return null;

    const options: Record<string, any> = {};
    if (root.options && typeof root.options === 'object') {
      for (const [key, val] of Object.entries(root.options as Record<string, any>)) {
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

    const desc = Array.isArray(root.description)
      ? root.description.join(' ')
      : (root.description || '');

    let deprecated: string | null = null;
    if (root.deprecated) {
      deprecated = typeof root.deprecated === 'object'
        ? (root.deprecated.why || root.deprecated.removed_in || 'deprecated')
        : String(root.deprecated);
    }

    return {
      short_description: root.short_description || root.module || '',
      description: desc,
      options,
      deprecated,
    };
  } catch {
    return null;
  }
}

// ─── List module files via GitHub API (handles subdirs) ────────────────────

interface ModuleFile {
  path: string;
  type: 'python' | 'yaml';
}

async function listModuleFiles(repo: string, modulesPath: string): Promise<ModuleFile[]> {
  const files: ModuleFile[] = [];
  const queue = [modulesPath];
  const seenModules = new Set<string>();

  while (queue.length > 0) {
    const dirPath = queue.shift()!;
    const url = `https://api.github.com/repos/${repo}/contents/${dirPath}`;
    let items: any;
    try {
      items = await ghFetch(url);
    } catch (e) {
      return files;
    }

    if (!items || !Array.isArray(items)) return files;

    for (const item of items) {
      if (item.type === 'dir') {
        queue.push(item.path);
      } else if (item.type === 'file' && !item.name.startsWith('_')) {
        const baseName = item.name.replace(/\.(py|yml|yaml)$/, '');
        if (item.name === '__init__.py') continue;

        if (item.name.endsWith('.py') && !seenModules.has(baseName)) {
          seenModules.add(baseName);
          files.push({ path: item.path, type: 'python' });
        } else if ((item.name.endsWith('.yml') || item.name.endsWith('.yaml')) && !seenModules.has(baseName)) {
          seenModules.add(baseName);
          files.push({ path: item.path, type: 'yaml' });
        }
      }
    }
  }
  return files;
}

// ─── Default branch detection ──────────────────────────────────────────────

async function getDefaultBranch(repo: string): Promise<string> {
  const data = await ghFetch(`https://api.github.com/repos/${repo}`);
  return data?.default_branch || 'main';
}

// ─── Process a single collection ───────────────────────────────────────────

async function processCollection(col: CollectionDef): Promise<Record<string, ModuleData>> {
  console.log(`\n── ${col.namespace} (${col.repo}) ──`);
  const branch = await getDefaultBranch(col.repo);

  const moduleFiles = await listModuleFiles(col.repo, col.modulesPath);
  if (moduleFiles.length === 0) {
    console.log(`  No module files found, skipping`);
    return {};
  }
  console.log(`  Found ${moduleFiles.length} module files`);

  const modules: Record<string, ModuleData> = {};
  let processed = 0;

  const BATCH = 10;
  for (let i = 0; i < moduleFiles.length; i += BATCH) {
    const batch = moduleFiles.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (mf) => {
        const ext = mf.path.endsWith('.py') ? '.py' : mf.path.endsWith('.yaml') ? '.yaml' : '.yml';
        const moduleName = path.basename(mf.path, ext);
        try {
          const source = await ghRaw(col.repo, branch, mf.path);
          const doc = mf.type === 'yaml'
            ? extractYamlDocumentation(source)
            : extractDocumentation(source);
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

    if (processed % 50 === 0 || processed === moduleFiles.length) {
      console.log(`  Processed ${processed}/${moduleFiles.length}`);
    }
  }

  return modules;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const outDir = path.resolve(__dirname, '..', 'server', 'data', 'modules');
  fs.mkdirSync(outDir, { recursive: true });

  let collections: CollectionDef[];

  if (args.length > 0) {
    // Specific collections requested via CLI args
    collections = [
      // Always include ansible.builtin if requested
      ...(args.includes('ansible.builtin') ? [{
        namespace: 'ansible.builtin',
        repo: 'ansible/ansible',
        modulesPath: 'lib/ansible/modules',
      }] : []),
      // Map other args to ansible-collections org repos
      ...args.filter(a => a !== 'ansible.builtin').map(name => ({
        namespace: name,
        repo: `ansible-collections/${name}`,
        modulesPath: 'plugins/modules',
      })),
    ];
  } else {
    // Auto-discover all collections
    if (!GITHUB_TOKEN) {
      console.warn('WARNING: Fetching ALL collections without GITHUB_TOKEN will hit rate limits.');
      console.warn('Set GITHUB_TOKEN=ghp_xxx or pass specific collections as arguments.\n');
    }
    collections = await discoverCollections();
  }

  console.log(`\nWill process ${collections.length} collections\n`);

  let totalModules = 0;
  let successCount = 0;
  let skipCount = 0;

  for (const col of collections) {
    try {
      const modules = await processCollection(col);
      const count = Object.keys(modules).length;

      if (count > 0) {
        const outFile = path.join(outDir, `${col.namespace}.json`);
        fs.writeFileSync(outFile, JSON.stringify(modules, null, 2));
        console.log(`  ✓ Wrote ${count} modules → ${col.namespace}.json`);
        totalModules += count;
        successCount++;
      } else {
        skipCount++;
      }
    } catch (e) {
      console.error(`  ✗ FAILED: ${col.namespace}: ${e}`);
      skipCount++;
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Done! ${totalModules} modules from ${successCount} collections (${skipCount} skipped)`);
  console.log(`GitHub API calls: ${apiCalls}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

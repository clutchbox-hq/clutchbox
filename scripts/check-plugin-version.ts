// CI: a change to the agent plugin (plugins/clutchbox) since the base commit needs a new version, the same in both
// manifests. Claude Code and Codex install from this repository and update an installed copy only when its version
// changes, so without a bump a new skill or MCP setting would never reach anyone who has it. Recipes count, since the
// plugin's skills are generated from them; the plugin's README doesn't.
// Usage: check-plugin-version <base commit>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { compareVersions } from '../packages/capture/src/index.ts';

const dir = 'plugins/clutchbox';
const manifests = [`${dir}/plugin.json`, `${dir}/.claude-plugin/plugin.json`];

const versions = manifests.map(file => JSON.parse(readFileSync(file, 'utf8')).version as string);
const after = versions[0] as string;
if (!/^\d+\.\d+\.\d+$/.test(after) || versions.some(version => version !== after)) {
  console.error(
    `The plugin's manifests need one MAJOR.MINOR.PATCH version: ${manifests.join(' and ')} say ${versions}.`,
  );
  process.exit(1);
}
const base = process.argv[2];
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
if (!base || /^0+$/.test(base)) {
  console.log('No base commit; skipping the plugin version check.');
  process.exit(0);
}
let before: string | undefined;
try {
  before = JSON.parse(git('show', `${base}:${manifests[0]}`)).version;
} catch {}
if (!before) {
  console.log(`The plugin is new since ${base}; it starts at ${after}.`);
  process.exit(0);
}
const changed = git('diff', '--name-only', base, 'HEAD', '--', dir)
  .split('\n')
  .filter(file => file && file !== `${dir}/README.md`);
if (before !== after && compareVersions(after, before) <= 0) {
  console.error(`Plugin version ${after} must be newer than ${before}.`);
  process.exit(1);
}
if (changed.length && before === after) {
  console.error(`The plugin changed without a version bump (still ${after}):`);
  for (const file of changed) console.error(`  ${file}`);
  process.exit(1);
}
console.log(changed.length ? `Plugin version ${before} -> ${after}.` : 'The plugin is unchanged.');

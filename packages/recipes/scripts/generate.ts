import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadCatalog, repositoryRoot } from '../src/load.ts';
import { pluginDir, pluginFiles } from '../src/plugin.ts';

// Writes src/catalog.generated.json and the plugin's skills (plugins/clutchbox/skills) from the repository's
// recipes/, or with --check, fails when either differs from them. The web apps import that JSON, so they never read
// files at runtime; agents install the skills straight from the repository.
//
//   generate-recipes [--check]

const catalog = loadCatalog();
const files: Record<string, string> = {
  'packages/recipes/src/catalog.generated.json': `${JSON.stringify(catalog, null, 2)}\n`,
  ...pluginFiles(catalog.recipes),
};
const skillsDir = path.join(repositoryRoot, pluginDir, 'skills');
const read = (file: string) => {
  try {
    return readFileSync(path.join(repositoryRoot, file), 'utf8');
  } catch {
    return undefined;
  }
};
const skillDirs = () => {
  try {
    return readdirSync(skillsDir);
  } catch {
    return [];
  }
};
// A skill whose recipe was removed or renamed.
const stale = skillDirs().filter(dir => !(`${pluginDir}/skills/${dir}/SKILL.md` in files));

if (process.argv.includes('--check')) {
  const wrong = [
    ...Object.keys(files).filter(file => read(file) !== files[file]),
    ...stale.map(dir => `${pluginDir}/skills/${dir}`),
  ];
  if (wrong.length) {
    console.error(`Out of date: ${wrong.join(', ')}. Run \`bun run generate-recipes\` and commit the result.`);
    process.exit(1);
  }
  console.log('The recipe catalog and the plugin skills are current.');
} else {
  for (const dir of stale) rmSync(path.join(skillsDir, dir), { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repositoryRoot, file)), { recursive: true });
    writeFileSync(path.join(repositoryRoot, file), text);
  }
  console.log(`Wrote the recipe catalog and ${catalog.recipes.length} plugin skills.`);
}

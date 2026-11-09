import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadCatalog } from '../src/load.ts';

// Writes src/catalog.generated.json from the repository's recipes/, or with --check, fails when it differs from them. The web apps import that JSON, so they never read files at runtime.
//
//   generate-recipes [--check]

const output = path.join(import.meta.dirname, '../src/catalog.generated.json');
const text = `${JSON.stringify(loadCatalog(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(output, 'utf8');
  } catch {}
  if (current !== text) {
    console.error('The recipe catalog is out of date. Run `bun run generate-recipes` and commit it.');
    process.exit(1);
  }
  console.log('The recipe catalog is current.');
} else {
  writeFileSync(output, text);
  console.log(`Wrote ${path.relative(process.cwd(), output)}.`);
}

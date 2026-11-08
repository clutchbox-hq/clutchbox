import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseRecipe } from './parse.ts';
import { compatibility, type Recipe, type SiteResult, USE_CASES } from './schema.ts';

// Reads every recipe and the site results from a checkout of the repository, for the generator and the tests. The web
// apps import the generated catalog (src/index.ts) instead, so nothing reads files at runtime.
export const repositoryRoot = path.join(import.meta.dirname, '../../..');

export function loadCatalog(root = repositoryRoot): { recipes: Recipe[]; sites: SiteResult[] } {
  const { sites } = compatibility.parse(JSON.parse(readFileSync(path.join(root, 'sites/compatibility.json'), 'utf8')));
  const known = new Set<string>();
  for (const { site } of sites) {
    if (known.has(site)) throw new Error(`sites/compatibility.json lists ${site} twice`);
    known.add(site);
  }
  const files = readdirSync(path.join(root, 'recipes'))
    .filter(file => file.endsWith('.md') && file !== 'README.md')
    .sort();
  const recipes = files.map(file =>
    parseRecipe(`recipes/${file}`, readFileSync(path.join(root, 'recipes', file), 'utf8')),
  );
  for (const recipe of recipes) {
    const missing = recipe.sites.filter(site => !known.has(site));
    if (missing.length)
      throw new Error(`${recipe.source}: add ${missing.join(', ')} to sites/compatibility.json (status untested)`);
  }
  // In the use cases' order, then by file name.
  const order = (recipe: Recipe) => USE_CASES.findIndex(({ key }) => key === recipe.useCase);
  recipes.sort((a, b) => order(a) - order(b));
  return { recipes, sites };
}

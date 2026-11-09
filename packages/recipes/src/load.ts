import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseRecipe } from './parse.ts';
import { type Recipe, USE_CASES } from './schema.ts';

// Reads every recipe from a checkout of the repository, for the generator and the tests. The web apps import the
// generated catalog (src/index.ts) instead, so nothing reads files at runtime.
export const repositoryRoot = path.join(import.meta.dirname, '../../..');

export function loadCatalog(root = repositoryRoot): { recipes: Recipe[] } {
  const files = readdirSync(path.join(root, 'recipes'))
    .filter(file => file.endsWith('.md') && file !== 'README.md')
    .sort();
  const recipes = files.map(file =>
    parseRecipe(`recipes/${file}`, readFileSync(path.join(root, 'recipes', file), 'utf8')),
  );
  // In the use cases' order, then by file name.
  const order = (recipe: Recipe) => USE_CASES.findIndex(({ key }) => key === recipe.useCase);
  recipes.sort((a, b) => order(a) - order(b));
  return { recipes };
}

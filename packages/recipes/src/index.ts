import catalog from './catalog.generated.json' with { type: 'json' };
import type { Recipe, UseCase } from './schema.ts';

// Recipes, from the repository's recipes/ through the generated catalog (scripts/generate.ts checked them against
// src/schema.ts).
export { AGENTS, USE_CASES } from './schema.ts';
export type { Recipe, UseCase };

export const recipes: readonly Recipe[] = catalog.recipes as Recipe[];
// The recipe's file in the public repository, to read or improve it.
export const sourceUrl = (recipe: Pick<Recipe, 'source'>) =>
  `https://github.com/clutchbox-hq/clutchbox/blob/main/${recipe.source}`;

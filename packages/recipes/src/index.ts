import catalog from './catalog.generated.json' with { type: 'json' };
import { ships } from './parse.ts';
import type { Recipe, SiteResult, UseCase } from './schema.ts';

// Recipes and site results, from the repository's recipes/ and sites/compatibility.json through the generated catalog
// (scripts/generate.ts checked them against src/schema.ts).
export { AGENTS, SITE_STATUSES, USE_CASES } from './schema.ts';
export type { Recipe, SiteResult, UseCase };

export const recipes: readonly Recipe[] = catalog.recipes as Recipe[];
export const siteResults: readonly SiteResult[] = catalog.sites as SiteResult[];
// Only these appear in the web app and get public pages.
export const shippedRecipes: readonly Recipe[] = recipes.filter(recipe => ships(recipe, siteResults));
export const siteResult = (site: string) => siteResults.find(result => result.site === site);
// The recipe's file in the public repository, to read or improve it.
export const sourceUrl = (recipe: Pick<Recipe, 'source'>) =>
  `https://github.com/clutchbox-hq/clutchbox/blob/main/${recipe.source}`;

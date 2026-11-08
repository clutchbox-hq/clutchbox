# @clutchbox/recipes

The recipes in [`recipes/`](../../recipes) and the site results in [`sites/compatibility.json`](../../sites/compatibility.json), for the web app.

- **`recipes`**, **`siteResults`**, and **`shippedRecipes`**: the recipes whose sites all work, the only ones the web app shows.
- **`scripts/generate.ts`** (`bun run generate-recipes`): checks every recipe and site against `src/schema.ts` and writes `src/catalog.generated.json`, which the web app imports so nothing reads files at runtime. `--check` fails when it is stale, as CI does.

How to write a recipe is in [`recipes/README.md`](../../recipes/README.md).

# @clutchbox/recipes

The recipes in [`recipes/`](../../recipes), for the web app and the agent plugin.

- **`recipes`**: every recipe. A deployment can list the ones it offers (`ShellExtras.recipes`).
- **`scripts/generate.ts`** (`bun run generate-recipes`): checks every recipe against `src/schema.ts` and writes `src/catalog.generated.json`, which the web app imports so nothing reads files at runtime, and the plugin's skills (`plugins/clutchbox/skills`, from `src/plugin.ts`), which agents install from the repository. `--check` fails when either is stale, as CI does.

How to write a recipe is in [`recipes/README.md`](../../recipes/README.md).

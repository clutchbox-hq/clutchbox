import { type Recipe, recipe, recipeFrontmatter, type SiteResult } from './schema.ts';

// Reads one recipe file: front matter in a small subset of YAML, then a Prompt section holding one fenced block and an
// optional Notes section of bullets (recipes/README.md). Throws with the file's name and what's wrong.

// The front matter: `key: value`, `key: [a, b]`, and one level of nesting (`key:` then indented `sub: value` lines).
export function parseFrontmatter(lines: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  let nested: Record<string, unknown> | undefined;
  for (const [index, line] of lines.entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^( *)([A-Za-z][\w-]*):(?: (.*))?$/.exec(line);
    if (!match) throw new Error(`front matter line ${index + 2} isn't "key: value": ${line}`);
    const [, indent = '', key = '', raw] = match;
    if (indent && !nested) throw new Error(`front matter line ${index + 2} is indented under nothing`);
    const target = indent ? nested! : data;
    if (!indent) nested = undefined;
    if (raw === undefined || !raw.trim()) {
      if (indent) throw new Error(`front matter line ${index + 2} nests too deep`);
      nested = {};
      data[key] = nested;
      continue;
    }
    target[key] = value(raw.trim());
  }
  return data;
}
const unquote = (text: string) => text.replace(/^(['"])(.*)\1$/, '$2');
const value = (raw: string) =>
  raw.startsWith('[') && raw.endsWith(']')
    ? raw
        .slice(1, -1)
        .split(',')
        .map(item => unquote(item.trim()))
        .filter(Boolean)
    : unquote(raw);

export function parseRecipe(file: string, text: string): Recipe {
  const slug = file.replace(/^.*\//, '').replace(/\.md$/, '');
  try {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    if (lines[0] !== '---') throw new Error('the file starts with front matter between --- lines');
    const end = lines.indexOf('---', 1);
    if (end === -1) throw new Error('the front matter has no closing --- line');
    const frontmatter = recipeFrontmatter.parse(parseFrontmatter(lines.slice(1, end)));
    const sections = new Map<string, string[]>();
    let current: string[] | undefined;
    for (const line of lines.slice(end + 1)) {
      const heading = /^## (.+)$/.exec(line);
      if (heading) {
        const name = heading[1]!.trim();
        if (name !== 'Prompt' && name !== 'Notes') throw new Error(`unknown section "${name}": use Prompt and Notes`);
        current = [];
        sections.set(name, current);
      } else if (current) current.push(line);
      else if (line.trim()) throw new Error(`text before the Prompt section: ${line}`);
    }
    return recipe.parse({
      ...frontmatter,
      slug,
      source: `recipes/${slug}.md`,
      prompt: fencedBlock(sections.get('Prompt')),
      notes: bullets(sections.get('Notes') ?? []),
    });
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fencedBlock(lines: string[] | undefined) {
  if (!lines) throw new Error('no Prompt section');
  const start = lines.findIndex(line => /^```(?:text)?$/.test(line));
  const end = lines.indexOf('```', start + 1);
  if (start === -1 || end === -1) throw new Error('the Prompt section holds one ```text fenced block');
  if (lines.slice(end + 1).some(line => line.trim()) || lines.slice(0, start).some(line => line.trim()))
    throw new Error('the Prompt section holds only its fenced block');
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

// Bullets, each `- text`, with indented lines continuing the one above.
function bullets(lines: string[]) {
  const items: string[] = [];
  for (const line of lines) {
    if (line.startsWith('- ')) items.push(line.slice(2).trim());
    else if (/^\s+\S/.test(line) && items.length) items[items.length - 1] += ` ${line.trim()}`;
    else if (line.trim()) throw new Error(`the Notes section holds only "- " bullets: ${line}`);
  }
  return items;
}

// A recipe ships (shows in the web app's gallery, and gets a public page) only when every site it uses works on a
// computer, by the recorded results.
export const ships = (candidate: Pick<Recipe, 'sites'>, sites: readonly SiteResult[]) =>
  candidate.sites.every(site => sites.find(result => result.site === site)?.status === 'works');

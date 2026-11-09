'use client';
import { siteName } from '@clutchbox/capture/sites';
import { recipes as allRecipes, type Recipe, sourceUrl, USE_CASES } from '@clutchbox/recipes';
import { Badge } from '@clutchbox/ui/components/badge';
import { Button, buttonVariants } from '@clutchbox/ui/components/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@clutchbox/ui/components/card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@clutchbox/ui/components/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@clutchbox/ui/components/tabs';
import { Check } from 'lucide-react';
import { useShell } from '../deployment.tsx';
import type { SetupView } from '../lib/api.ts';
import { missingSites } from '../lib/setup.ts';
import { CopyButton } from './copy-button.tsx';
import { scheduleSteps } from './recipe-steps.tsx';

// The recipes this deployment offers (ShellExtras.recipes). With none, the overview keeps its generic prompts instead
// of an empty gallery.
export function useOfferedRecipes(): readonly Recipe[] {
  const { recipes: slugs } = useShell();
  return slugs ? allRecipes.filter(recipe => slugs.includes(recipe.slug)) : allRecipes;
}

// The recipes on offer, by use case: each names its sites and whether the user syncs them yet, with its prompt to
// copy and the steps to run it on the agent's own schedule. Shown where setup ends and on the overview after it.
export function RecipeGallery({ sync, mcpUrl }: { sync: SetupView['sync']; mcpUrl: string }) {
  const offered = useOfferedRecipes();
  const groups = USE_CASES.map(useCase => ({
    ...useCase,
    recipes: offered.filter(recipe => recipe.useCase === useCase.key),
  })).filter(group => group.recipes.length);
  // Open on the use case with the most recipes the user can run now.
  const ready = (recipes: readonly Recipe[]) =>
    recipes.filter(recipe => missingSites(recipe.sites, sync)?.length === 0).length;
  const first = [...groups].sort((a, b) => ready(b.recipes) - ready(a.recipes))[0];
  if (!first) return null;
  return (
    <Tabs defaultValue={first.key}>
      <TabsList aria-label="Use cases">
        {groups.map(group => (
          <TabsTrigger key={group.key} value={group.key}>
            {group.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {groups.map(group => (
        <TabsContent key={group.key} value={group.key}>
          <ul className="grid gap-3 md:grid-cols-2">
            {group.recipes.map(recipe => (
              <li key={recipe.slug} className="grid">
                <RecipeCard recipe={recipe} missing={missingSites(recipe.sites, sync)} mcpUrl={mcpUrl} />
              </li>
            ))}
          </ul>
        </TabsContent>
      ))}
    </Tabs>
  );
}

function RecipeCard({ recipe, missing, mcpUrl }: { recipe: Recipe; missing: string[] | null; mcpUrl: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h3>{recipe.title}</h3>
        </CardTitle>
        <CardDescription>{recipe.summary}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Sites sites={recipe.sites} missing={missing} />
        <p className="text-sm text-muted-foreground">{recipe.schedule.when}</p>
      </CardContent>
      <CardFooter className="mt-auto flex flex-wrap gap-2">
        <CopyButton text={recipe.prompt} label={`Copy the prompt for ${recipe.title}`} />
        <Details recipe={recipe} missing={missing} mcpUrl={mcpUrl} />
      </CardFooter>
    </Card>
  );
}

// The recipe's sites, each marked synced or not, and what to add in the extension, which is the only place sites are
// added. Without readable sync settings, just the names.
function Sites({ sites, missing }: { sites: readonly string[]; missing: string[] | null }) {
  return (
    <>
      <ul className="flex flex-wrap gap-1.5" aria-label="Sites it uses">
        {sites.map(site => {
          const synced = missing !== null && !missing.includes(site);
          return (
            <li key={site}>
              <Badge variant={synced ? 'secondary' : 'outline'}>
                {synced && <Check aria-hidden />}
                {siteName(site)}
                {missing !== null && <span className="sr-only">{synced ? ', synced' : ', not synced yet'}</span>}
              </Badge>
            </li>
          );
        })}
      </ul>
      {missing?.length ? (
        <p className="text-sm text-foreground">
          Add {missing.join(', ')} in the Clutchbox extension first, and sign in to {missing.length > 1 ? 'them' : 'it'}{' '}
          in your browser.
        </p>
      ) : null}
    </>
  );
}

function Details({ recipe, missing, mcpUrl }: { recipe: Recipe; missing: string[] | null; mcpUrl: string }) {
  const agents = scheduleSteps(recipe, mcpUrl);
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" />}>Details</SheetTrigger>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{recipe.title}</SheetTitle>
          <SheetDescription>{recipe.summary}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-6 px-4 pb-6">
          <section className="grid gap-3" aria-labelledby={`${recipe.slug}-prompt`}>
            <div className="flex items-center justify-between gap-3">
              <h3 id={`${recipe.slug}-prompt`} className="font-medium">
                Prompt
              </h3>
              <CopyButton text={recipe.prompt} label="Copy the prompt" />
            </div>
            <pre className="max-h-80 overflow-y-auto rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap">
              {recipe.prompt}
            </pre>
            <p className="text-sm text-muted-foreground">
              Change the settings at the top to suit you before you run it.
            </p>
          </section>
          <section className="grid gap-3">
            <h3 className="font-medium">Sites</h3>
            <Sites sites={recipe.sites} missing={missing} />
            {recipe.notes.length > 0 && (
              <ul className="grid list-disc gap-1 pl-5 text-sm text-foreground">
                {recipe.notes.map(note => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </section>
          <section className="grid gap-3">
            <h3 className="font-medium">Run it on a schedule</h3>
            <p className="text-sm text-muted-foreground">{recipe.schedule.when}, in your agent’s own scheduler.</p>
            <Tabs defaultValue={agents[0]?.kind}>
              <TabsList aria-label="Agents">
                {agents.map(agent => (
                  <TabsTrigger key={agent.kind} value={agent.kind}>
                    {agent.name}
                  </TabsTrigger>
                ))}
              </TabsList>
              {agents.map(agent => (
                <TabsContent key={agent.kind} value={agent.kind} className="pt-2">
                  {agent.steps}
                </TabsContent>
              ))}
            </Tabs>
          </section>
          <a
            href={sourceUrl(recipe)}
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: 'link', className: 'justify-self-start p-0' })}
          >
            Read or improve this recipe on GitHub
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}

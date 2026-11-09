'use client';
import {
  COMPUTER_SIZE_NAMES,
  type ComputerSize,
  SCREEN_NAMES,
  SCREENS,
  type ScreenSize,
  sizeName,
} from '@clutchbox/computer';
import { Alert, AlertDescription } from '@clutchbox/ui/components/alert';
import { Button } from '@clutchbox/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clutchbox/ui/components/card';
import { ToggleGroup, ToggleGroupItem } from '@clutchbox/ui/components/toggle-group';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useShell } from '../deployment.tsx';
import { api, type ComputerView, computerQuery, grantsQuery } from '../lib/api.ts';
import { computerStatus, resetsOn, syncedSignIns, usedShare } from '../lib/computer.ts';
import { lastUser } from './agent-connections.tsx';
import { AppPage } from './app-shell.tsx';
import { LiveViewPanel } from './live-view.tsx';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
// The Computer page: status and usage, the member's computers with live view in place, what new ones are made at, and
// deleting them all.
export function YourComputer() {
  const { data: view, isError } = useQuery(computerQuery);
  return (
    <AppPage
      wide
      title="Your computers"
      description="Linux desktops with a browser, signed in from yours. Each sleeps when idle and wakes when it's opened."
    >
      {view ? (
        <>
          <ComputerStats view={view} />
          <LiveViewPanel
            computers={view.computers}
            limit={view.limit}
            replaces={view.replaces}
            exhausted={
              view.usage?.hardStop && view.usage.usedShare >= 1
                ? {
                    message: `The computer credit is used up. It renews on ${resetsOn(view.usage.resetsAt)}.`,
                  }
                : null
            }
          />
          <ComputerSizeCard view={view} />
          <ScreenSizeCard view={view} />
          {view.computers.length > 0 && <DeleteAllComputers count={view.computers.length} />}
        </>
      ) : (
        <p className="text-foreground">
          {isError ? 'Your computers could not load. Reload to try again.' : 'Loading…'}
        </p>
      )}
    </AppPage>
  );
}

function ComputerStats({ view }: { view: ComputerView }) {
  const shell = useShell();
  const { data: grants = [] } = useQuery(grantsQuery);
  const status = computerStatus(view);
  const used = lastUser(grants);
  const synced = syncedSignIns(view);
  const { usage } = view;
  const stats = [
    { label: 'Status', value: status.short, note: status.note, dot: status.dot },
    // Only with a credit (the metering hook).
    ...(usage
      ? [
          {
            label: 'Computer time',
            value: `${usage.cost} of ${usage.credit}`,
            note: `Since ${resetsOn(view.period.start)} · renews ${resetsOn(usage.resetsAt)}${usage.estimate ? ` · estimated bill ${usage.estimate}` : ''}`,
            bar: usedShare(usage),
          },
        ]
      : []),
    // On the organization's own provider account, which bills it directly, so no credit applies.
    ...(view.account === 'organization'
      ? [
          {
            label: 'Runs on',
            value: shell.onePerson ? 'Your own account' : "Your organization's own account",
            note: 'Its provider bills it directly',
          },
        ]
      : []),
    used
      ? { label: 'Last used by', value: used.name, note: when(used.at) }
      : { label: 'Last used by', value: 'No agent yet', note: 'Ask a connected agent to open a computer.' },
    synced
      ? {
          label: 'Synced sign-ins',
          value: when(synced.copiedAt),
          note: 'Applied each time a computer opens',
        }
      : { label: 'Synced sign-ins', value: 'None yet', note: 'Set up browser sync to add them.' },
  ];
  return (
    <Card className="grid grid-cols-1 gap-0 py-0 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map(stat => (
        <div
          key={stat.label}
          className="grid content-start gap-1 border-foreground/10 p-4 not-last:max-sm:border-b sm:max-lg:nth-[-n+2]:border-b sm:max-lg:odd:border-r lg:not-last:border-r"
        >
          <span className="text-xs text-muted-foreground">{stat.label}</span>
          <span className="flex items-center gap-2 font-heading text-xl">
            {'dot' in stat && <span aria-hidden className={`size-2 shrink-0 rounded-full ${stat.dot}`} />}
            {stat.value}
          </span>
          {'bar' in stat && (
            <span className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="block h-full rounded-full bg-foreground" style={{ width: `${stat.bar}%` }} />
            </span>
          )}
          <span className="text-xs text-muted-foreground">{stat.note}</span>
        </div>
      ))}
    </Card>
  );
}

// Chooses the size new computers start at; existing ones keep theirs.
function ComputerSizeCard({ view }: { view: ComputerView }) {
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (size: ComputerSize) => api('/computer/size', 'PUT', { size }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: computerQuery.queryKey }),
  });
  const shown = change.isPending ? change.variables : view.size;
  return (
    <Card id="size" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>
          <h2>Computer size</h2>
        </CardTitle>
        <CardDescription>
          More CPUs and memory for heavy sites and many tabs. Applies to new computers.
          {view.usage &&
            ' A larger computer uses your credit faster, at its cost: twice the CPUs and memory, twice the rate.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ToggleGroup
          aria-label="Computer size"
          variant="outline"
          spacing={0}
          value={[shown]}
          disabled={change.isPending}
          onValueChange={([next]) => {
            if (next && next !== shown) change.mutate(next as ComputerSize);
          }}
        >
          {COMPUTER_SIZE_NAMES.map(size => (
            <ToggleGroupItem key={size} value={size} className="h-auto flex-col items-start gap-0 px-4 py-2">
              <span className="font-medium">{size}</span>
              <span className="text-xs text-muted-foreground">{sizeName(size)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {change.isError && (
          <Alert variant="destructive">
            <AlertDescription>{change.error.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

const screenNames: Record<ScreenSize, string> = {
  '1440x900': 'Standard',
  '1280x1024': 'Taller',
  '1920x1200': 'Largest',
};
const pixels = (screen: ScreenSize) => `${SCREENS[screen].width} × ${SCREENS[screen].height}`;

// Chooses the screen size new computers start at; existing ones keep theirs.
function ScreenSizeCard({ view }: { view: ComputerView }) {
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (screen: ScreenSize) => api('/computer/screen', 'PUT', { screen }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: computerQuery.queryKey }),
  });
  const shown = change.isPending ? change.variables : view.screen;
  return (
    <Card id="screen" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>
          <h2>Screen size</h2>
        </CardTitle>
        <CardDescription>
          The screen of each new computer. A bigger screen shows more of a page, and each screenshot costs an agent more
          tokens.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ToggleGroup
          aria-label="Screen size"
          variant="outline"
          spacing={0}
          value={[shown]}
          disabled={change.isPending}
          onValueChange={([next]) => {
            if (next && next !== shown) change.mutate(next as ScreenSize);
          }}
        >
          {SCREEN_NAMES.map(screen => (
            <ToggleGroupItem key={screen} value={screen} className="h-auto flex-col items-start gap-0 px-4 py-2">
              <span className="font-medium">{screenNames[screen]}</span>
              <span className="text-xs text-muted-foreground">{pixels(screen)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {change.isError && (
          <Alert variant="destructive">
            <AlertDescription>{change.error.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

// Deletes every computer the member has; synced data and setup stay.
function DeleteAllComputers({ count }: { count: number }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => api('/computer/computers', 'DELETE'),
    onSuccess: () => {
      setConfirm(false);
      return queryClient.invalidateQueries({ queryKey: computerQuery.queryKey });
    },
  });
  return (
    <Card id="delete-computers" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>
          <h2>Delete all computers</h2>
        </CardTitle>
        <CardDescription>Delete every computer you have, keeping your synced browser data.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {confirm ? (
          <div className="grid gap-3 rounded-lg bg-muted p-4">
            <p className="text-sm">
              This deletes {count === 1 ? 'your computer' : `all ${count} of your computers`}, with their files and
              every sign-in made on them, and stops any agent using one. Your synced sites come back on the next
              computer.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending ? 'Deleting…' : 'Delete all computers'}
              </Button>
              <Button variant="secondary" disabled={remove.isPending} onClick={() => setConfirm(false)}>
                Keep them
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              variant="outline"
              onClick={() => {
                remove.reset();
                setConfirm(true);
              }}
            >
              Delete all computers…
            </Button>
          </div>
        )}
        {remove.isError && (
          <Alert variant="destructive">
            <AlertDescription>{remove.error.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/// <reference path="../lib/novnc.d.ts" />
'use client';
import { Alert, AlertDescription, AlertTitle } from '@clutchbox/ui/components/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@clutchbox/ui/components/alert-dialog';
import { Button } from '@clutchbox/ui/components/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@clutchbox/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@clutchbox/ui/components/item';
import { Spinner } from '@clutchbox/ui/components/spinner';
import { ToggleGroup, ToggleGroupItem } from '@clutchbox/ui/components/toggle-group';
import type RFB from '@novnc/novnc';
import { Eye, Maximize, MousePointer2, Plus, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type ComputerView,
  type HeartbeatLease,
  type LiveViewStatus,
  useDeleteComputer,
  useHeartbeat,
  useLiveViewClipboard,
  useLiveViewControl,
  useNewComputer,
} from '../lib/api.ts';
import {
  chord,
  clipboardEntries,
  decodeCutText,
  eventEntries,
  isMac,
  keyAction,
  keyQueue,
  keysymOf,
  MODIFIER_CODES,
  type Pasted,
  pastedContent,
} from '../lib/live-view-input.ts';
import { agentName } from './agent-connections.tsx';
import { useLeaveGuard } from './app-shell.tsx';
import { Failure } from './failure.tsx';

// Close codes from the relay (RELAY_CLOSE in packages/server/src/live-view-relay.ts): 4000 is its clean close
// before the route's time limit, so reconnect at once; 4001 means this lease lost its watch (hidden too long) or the
// sign-in ended, so wait for a beat that finds it watching; 4002 means the computer predates private live view, so it must be replaced; 1008 is the
// RFB filter refusing what this page sent, which a retry would repeat. Any other close is a drop, retried with
// backoff while the page is visible.
const RECONNECT_NOW = 4000;
const NOT_WATCHING = 4001;
const TOO_OLD = 4002;
const POLICY = 1008;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
// How long a paste shortcut waits for the browser's paste event before reading the clipboard instead: Chrome on macOS
// delivers it through the Edit menu, a round trip after the keydown.
const PASTE_EVENT_MS = 250;
// A paste whose control ended before it finished, or whose connection's input was detached: it shows nothing.
const LOST = Symbol('lost');

// waiting: stopped retrying until a heartbeat finds the page watching while visible.
type Viewer = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'waiting' | 'tooOld' | 'refused' | 'failed';

type Computer = ComputerView['computers'][number];
type Intent = 'watch' | 'control';
// The computer live view is on, by ID, with the name shown.
type Target = { computer: string; name: string };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const agentOf = ({ agent, host }: NonNullable<Computer['agent']>) => (agent ? agentName(agent) : host);
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
// A computer's name: only agents label one, so without a label, its agent or the day it was made.
const computerName = (computer: Computer) =>
  computer.label ??
  (computer.agent ? `${agentOf(computer.agent)}'s computer` : `Computer from ${day(computer.createdAt)}`);
const statusNames: Record<Computer['status'], string> = {
  starting: 'Starting',
  in_use: 'Working now',
  running: 'Idle',
  paused: 'Paused',
};

// The member's computers, and live view through our relay (noVNC) on the one they choose. It starts only when the user
// chooses Watch or Take control, so opening the page neither wakes a computer nor uses its time. A session's lease keeps
// a watch while the page is visible (useHeartbeat), and holds the takeover once the user takes control; the relay passes
// input only while it does, so noVNC's viewOnly only spares the user dead input. Stopping, switching computers, or
// leaving the page releases the lease, which ends the watch and hands back. exhausted: the credit is used up (as
// LiveViewStatus says), until it resets. limit and replaces: how many the member may have, and which a new computer would
// replace at that limit. A link with ?computer=<ID>, the live-view link the REST API gives developers, starts watching
// that computer.
export function LiveViewPanel({
  exhausted,
  computers,
  limit,
  replaces,
}: {
  exhausted: { message: string } | null;
  computers: Computer[];
  limit: number;
  replaces: Computer | null;
}) {
  const linkedId = useSearchParams().get('computer');
  const linked = computers.find(computer => computer.computerId === linkedId);
  const [session, setSession] = useState<{ intent: Intent; target: Target } | null>(() =>
    linked ? { intent: 'watch', target: { computer: linked.computerId, name: computerName(linked) } } : null,
  );
  const start = (intent: Intent, target: Target) => setSession({ intent, target });
  return (
    <>
      <ComputerList
        computers={computers}
        limit={limit}
        replaces={replaces}
        viewing={session?.target.computer}
        exhausted={!!exhausted}
        onStart={start}
        onDeleted={id => setSession(current => (current?.target.computer === id ? null : current))}
      />
      {session && (
        <LiveSession
          key={session.target.computer}
          intent={session.intent}
          target={session.target}
          onStop={() => setSession(null)}
        />
      )}
    </>
  );
}

// The member's computers, each with what it is doing, Watch and Take control, and delete, and the way to make one.
// viewing: the computer live view is on.
function ComputerList({
  computers,
  limit,
  replaces,
  viewing,
  exhausted,
  onStart,
  onDeleted,
}: {
  computers: Computer[];
  limit: number;
  replaces: Computer | null;
  viewing: string | undefined;
  exhausted: boolean;
  onStart: (intent: Intent, target: Target) => void;
  onDeleted: (id: string) => void;
}) {
  const make = <NewComputer count={computers.length} limit={limit} replaces={replaces} exhausted={exhausted} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Computers</h2>
        </CardTitle>
        <CardDescription>
          Each computer is for one task, and starts fresh with your newest sign-ins. Watch one, or take control to help
          an agent past a sign-in or a check; the agent waits until you hand back.
        </CardDescription>
        {computers.length > 0 && <CardAction>{make}</CardAction>}
      </CardHeader>
      <CardContent>
        {computers.length > 0 ? (
          <ItemGroup className="gap-0">
            {computers.map((computer, index) => (
              <div key={computer.computerId}>
                {index > 0 && <ItemSeparator />}
                <ComputerRow
                  computer={computer}
                  viewing={viewing === computer.computerId}
                  exhausted={exhausted}
                  onStart={onStart}
                  onDeleted={onDeleted}
                />
              </div>
            ))}
          </ItemGroup>
        ) : (
          <div className="grid justify-items-center gap-3 rounded-lg bg-muted p-8 text-center">
            <p className="font-heading text-xl">No computers yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              An agent makes one when it starts a task. Make one now to sign in to a site or look around.
            </p>
            {make}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ComputerRow({
  computer,
  viewing,
  exhausted,
  onStart,
  onDeleted,
}: {
  computer: Computer;
  viewing: boolean;
  exhausted: boolean;
  onStart: (intent: Intent, target: Target) => void;
  onDeleted: (id: string) => void;
}) {
  const { computerId, status, agent } = computer;
  const name = computerName(computer);
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteComputer();
  const starting = status === 'starting';
  const target = { computer: computerId, name };
  return (
    <>
      <Item className="px-0">
        <ItemContent>
          <ItemTitle>{name}</ItemTitle>
          <ItemDescription>
            {[...(agent ? [agentOf(agent)] : []), statusNames[status], `Last used ${when(computer.lastUsedAt)}`].join(
              ' · ',
            )}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="flex-wrap justify-end">
          {viewing ? (
            <span className="text-sm text-muted-foreground">In live view</span>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={exhausted || starting}
                onClick={() => onStart('watch', target)}
              >
                <Eye aria-hidden />
                Watch
              </Button>
              <Button size="sm" disabled={exhausted || starting} onClick={() => onStart('control', target)}>
                <MousePointer2 aria-hidden />
                Take control
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Delete ${name}`}
            disabled={starting || status === 'in_use' || remove.isPending}
            onClick={() => {
              remove.reset();
              setConfirming(true);
            }}
          >
            <Trash2 aria-hidden />
          </Button>
        </ItemActions>
      </Item>
      <Failure error={remove.error} />
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its files, its tabs, and every sign-in made on it are deleted. Agents that kept its ID can't return to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                remove.mutate(computerId, { onSuccess: () => onDeleted(computerId) });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Makes a computer with no agent. At the limit it replaces the one the server named, once the member confirms; with none
// to replace, or a plan that allows none, it can't, and says why.
function NewComputer({
  count,
  limit,
  replaces,
  exhausted,
}: {
  count: number;
  limit: number;
  replaces: Computer | null;
  exhausted: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const create = useNewComputer();
  const atLimit = count >= limit;
  const why =
    limit === 0
      ? "This account's plan allows no computers."
      : atLimit && !replaces
        ? 'All your computers are in use. Try again when one is idle.'
        : null;
  return (
    <div className="grid justify-items-end gap-2">
      <Button
        disabled={create.isPending || exhausted || !!why}
        onClick={() => {
          create.reset();
          if (atLimit) setConfirming(true);
          else create.mutate(undefined);
        }}
      >
        {create.isPending ? <Spinner aria-hidden /> : <Plus aria-hidden />}
        New computer
      </Button>
      {why && <p className="text-xs text-muted-foreground">{why}</p>}
      <Failure error={create.error} />
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace {replaces ? computerName(replaces) : 'a computer'}?</AlertDialogTitle>
            <AlertDialogDescription>
              You have as many computers as you can. A new one replaces your least recently used idle computer
              {replaces && `, last used ${when(replaces.lastUsedAt)}`}. Its files, its tabs, and every sign-in made on
              it are deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                create.mutate(replaces?.computerId);
              }}
            >
              Replace it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LiveSession({ intent, target, onStop }: { intent: Intent; target: Target; onStop: () => void }) {
  const { computer } = target;
  const [lease] = useState(() => crypto.randomUUID());
  const leases = useMemo<HeartbeatLease[]>(() => [{ kind: 'live-view', id: lease, computer }], [lease, computer]);
  const { statusOf, isError, setStatus, updatedAt } = useHeartbeat(leases);
  const status = statusOf('live-view', lease);
  const { takeOver, handBack } = useLiveViewControl(lease, computer, setStatus);
  const clipboard = useLiveViewClipboard(lease, computer);
  const inControl = !!status?.takeover?.mine;
  // The relay accepts this lease only while it holds a live watch or the takeover.
  const connectable = !!status && (status.watching || inControl);
  const viewer = useViewer(lease, computer, connectable, inControl, updatedAt, clipboard.mutateAsync);
  const lapsed = useLapsed(status, handBack.isPending);
  const exhausted = status?.creditExhausted;
  // Take control as soon as the first beat answers, when that is what the user chose.
  const asked = useRef(false);
  useEffect(() => {
    if (intent !== 'control' || asked.current || !status || exhausted) return;
    asked.current = true;
    takeOver.mutate();
  }, [intent, status, exhausted, takeOver]);
  const leaving = useLeaveConfirm(inControl, handBack.mutateAsync);
  const box = useRef<HTMLDivElement>(null);

  const mode = inControl ? 'control' : 'watch';
  const switching = takeOver.isPending ? 'control' : handBack.isPending ? 'watch' : null;
  const waiting = inControl ? status?.agentWaiting : null;
  const problem = (takeOver.error ?? handBack.error)?.message ?? viewer.problem;
  return (
    <Card>
      <div
        ref={box}
        className="grid gap-4 [&:fullscreen]:content-start [&:fullscreen]:bg-background [&:fullscreen]:p-4"
      >
        <CardHeader className="flex flex-wrap items-center gap-3">
          <CardTitle className="flex-1">
            <h2>Live view: {target.name}</h2>
          </CardTitle>
          {inControl && (
            <p className="text-sm text-muted-foreground">
              Copy and paste with {mac() ? '⌘C and ⌘V' : 'Ctrl+C and Ctrl+V'}
            </p>
          )}
          {/* A mode the server grants, not a setting: it shows the takeover's state, which can end without a click. */}
          <ToggleGroup
            aria-label="Mode"
            variant="outline"
            spacing={0}
            value={[switching ?? mode]}
            disabled={!status || !!switching}
            onValueChange={([next]) => {
              if (next === 'control' && mode === 'watch') {
                handBack.reset();
                takeOver.mutate();
              }
              if (next === 'watch' && mode === 'control') handBack.mutate();
            }}
          >
            <ToggleGroupItem value="watch">
              {handBack.isPending ? <Spinner aria-hidden /> : <Eye aria-hidden />}
              Watch
            </ToggleGroupItem>
            <ToggleGroupItem value="control" disabled={!!exhausted && !inControl}>
              {takeOver.isPending ? <Spinner aria-hidden /> : <MousePointer2 aria-hidden />}
              Control
            </ToggleGroupItem>
          </ToggleGroup>
          {/* Ending the session releases the lease, which hands back too. */}
          <Button variant="ghost" onClick={onStop}>
            Stop
          </Button>
          <Button
            variant="ghost"
            className="size-11 px-0"
            aria-label="Full screen"
            onClick={() =>
              document.fullscreenElement ? void document.exitFullscreen() : void box.current?.requestFullscreen()
            }
          >
            <Maximize aria-hidden />
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-foreground" role="status" aria-live="polite">
            {describe({ status, isError, viewer: viewer.state })}
          </p>
          {waiting && (
            <Alert>
              <AlertTitle>
                {waiting.agent ? agentName(waiting.agent) : `An agent at ${waiting.host}`} is waiting for this computer
              </AlertTitle>
              <AlertDescription>
                It asked to use it at {time(waiting.since)}. Switch to Watch or stop when you're done, and it carries on
                from here.
              </AlertDescription>
            </Alert>
          )}
          {viewer.state === 'tooOld' && (
            <Alert>
              <AlertTitle>Delete this computer to use live view</AlertTitle>
              <AlertDescription>
                This computer was made before live view, which needs it to be private. Delete it and make a new one to
                watch or control it.
              </AlertDescription>
            </Alert>
          )}
          {lapsed && !inControl && (
            <Alert>
              <AlertDescription>
                Your control ended because this page was hidden or offline for over a minute. Switch to Control again to
                continue.
              </AlertDescription>
            </Alert>
          )}
          {exhausted && (
            <Alert variant="destructive">
              <AlertDescription>{exhausted.message} Live view is off.</AlertDescription>
            </Alert>
          )}
          {problem && (
            <Alert variant="destructive">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          )}
          {/* 16:10 until the screen's size is known: a new computer's 1440x900, and an older one's 1280x800. */}
          <div
            className={`relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-black ${inControl ? 'ring-2 ring-brand' : 'ring-1 ring-foreground/10'}`}
            style={viewer.size ? { aspectRatio: `${viewer.size.width} / ${viewer.size.height}` } : undefined}
          >
            {/* noVNC owns this element's children. */}
            <div ref={viewer.screen} className="absolute inset-0" />
          </div>
          {inControl && (
            <Alert>
              <AlertTitle>Signing in here</AlertTitle>
              <AlertDescription>
                A sign-in you make here stays on this computer only. To have it on every new computer, sign in to the
                site in your own browser and sync it.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </div>
      <AlertDialog open={!!leaving.pending} onOpenChange={open => !open && leaving.cancel()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hand back and leave?</AlertDialogTitle>
            <AlertDialogDescription>
              You're in control of this computer. Leaving this page hands it back, so an agent waiting for it carries
              on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={leaving.confirm}>Hand back and leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// While the user is in control, leaving asks first: in-app links through the app's leave guard, and closing or
// reloading the tab through the browser's own prompt. Confirming hands back, then leaves; a failed hand-back still
// leaves, since the release on unmount ends the takeover too.
function useLeaveConfirm(inControl: boolean, handBack: () => Promise<unknown>) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = useCallback((leave: () => void) => {
    setPending(() => leave);
    return true;
  }, []);
  useLeaveGuard(inControl ? guard : null);
  useEffect(() => {
    if (!inControl) return;
    const prompt = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', prompt);
    return () => window.removeEventListener('beforeunload', prompt);
  }, [inControl]);
  return {
    pending,
    cancel: () => setPending(null),
    confirm: () => {
      const leave = pending;
      setPending(null);
      void handBack()
        .catch(() => {})
        .finally(() => leave?.());
    },
  };
}

function describe({
  status,
  isError,
  viewer,
}: {
  status: LiveViewStatus | undefined;
  isError: boolean;
  viewer: Viewer;
}) {
  if (!status) return isError ? 'Live view could not load. Reload to try again.' : 'Loading…';
  // Live view never creates a computer: one that is gone was deleted or replaced.
  if (status.computer === 'none') return 'This computer was deleted.';
  if (viewer === 'refused') return 'Live view closed the connection. Reload the page to try again.';
  if (viewer === 'failed') return 'Live view could not start. Reload the page to try again.';
  if (viewer === 'tooOld') return 'This computer is too old for live view.';
  if (viewer === 'waiting')
    return isError
      ? 'Live view lost touch with the server. Reload the page to try again.'
      : 'Live view is paused. It resumes while this page is visible.';
  if (status.creditExhausted && !status.watching) return 'The computer is asleep.';
  if (viewer === 'connecting') return status.computer === 'paused' ? 'Waking the computer…' : 'Connecting…';
  if (viewer === 'reconnecting') return 'Reconnecting…';
  if (status.takeover?.mine)
    return "You're in control. An agent on this computer waits until you switch to Watch or stop.";
  if (status.takeover) return "You're in control in another tab. Switch to Control here to move it to this one.";
  if (viewer === 'connected') return 'Watching. Switch to Control to use the mouse and keyboard.';
  return 'Connecting…';
}

const mac = () => typeof navigator !== 'undefined' && isMac(navigator.platform);

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// noVNC on this lease's relay connection, to the computer named, while it is connectable, reconnecting after drops
// while the page is visible. viewOnly follows the takeover without reconnecting. A computer's screen size is set when
// it is made, so the page never resizes it; size is that screen's, for the view's shape. beatAt is when the heartbeat last answered. setClipboard sets the computer's clipboard for a paste
// (useLiveViewClipboard); problem is why the last paste failed.
function useViewer(
  lease: string,
  computer: string,
  connectable: boolean,
  inControl: boolean,
  beatAt: number,
  setClipboard: (content: Pasted) => Promise<unknown>,
) {
  const screen = useRef<HTMLDivElement>(null);
  const client = useRef<RFB | null>(null);
  const control = useRef(inControl);
  // Bumped whenever control changes, so a paste still in flight from before says nothing.
  const epoch = useRef(0);
  const [state, setState] = useState<Viewer>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const paste = useRef(setClipboard);
  useEffect(() => {
    paste.current = setClipboard;
  }, [setClipboard]);
  // Bumped to start over, with no backoff, once a beat after the viewer stopped finds the page watching.
  const [generation, setGeneration] = useState(0);
  const waitingSince = useRef(0);
  useEffect(() => {
    if (state === 'waiting' && connectable && beatAt > waitingSince.current && !document.hidden)
      setGeneration(next => next + 1);
  }, [state, connectable, beatAt]);
  useEffect(() => {
    control.current = inControl;
    epoch.current += 1;
    setProblem(null);
    if (!client.current) return;
    client.current.viewOnly = !inControl;
    if (inControl) client.current.focus({ preventScroll: true });
  }, [inControl]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: generation is not read inside; a new one restarts the connection.
  useEffect(() => {
    const target = screen.current;
    if (!connectable || !target) return;
    const detachInput = attachInput(target, client, paste, setProblem, epoch);
    // noVNC sizes its canvas to the computer's screen, and again when the screen changes size.
    const resized = new MutationObserver(() => {
      const canvas = target.querySelector('canvas');
      if (!canvas?.width || !canvas.height) return;
      const { width, height } = canvas;
      setSize(last => (last?.width === width && last.height === height ? last : { width, height }));
    });
    resized.observe(target, { subtree: true, attributeFilter: ['width', 'height'] });
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = () => {
      waitingSince.current = Date.now();
      setState('waiting');
    };
    const connect = async () => {
      setState(attempt ? 'reconnecting' : 'connecting');
      // noVNC reads window and document as it loads, so it loads here, in the browser, never on the server.
      const { default: RFB } = await import('@novnc/novnc');
      if (stopped) return;
      // A fresh ticket for each connection, which opens the relay where the API runs; a refusal is retried like a
      // dropped connection.
      const ticket = await api<{ url: string }>('/live-view/ticket', 'POST', {
        lease,
        computer,
      }).catch(() => null);
      if (stopped) return;
      if (!ticket) return retry(0);
      // Opened here rather than by noVNC, to read the close code it does not report.
      const socket = new WebSocket(ticket.url, 'binary');
      let code = 0;
      socket.addEventListener('close', event => {
        code = event.code;
      });
      const rfb = new RFB(target, socket, { shared: true });
      rfb.viewOnly = !control.current;
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.background = 'transparent';
      rfb.addEventListener('connect', () => {
        attempt = 0;
        setState('connected');
      });
      // What the computer copies reaches this device's clipboard while the user is in control (noVNC sends no
      // clipboard event in view-only); the browser may refuse without focus, which costs nothing. Empty text is the
      // VNC server's, not a copy.
      rfb.addEventListener('clipboard', event => {
        const text = decodeCutText((event as CustomEvent<{ text: string }>).detail.text);
        if (text) void navigator.clipboard?.writeText(text).catch(() => {});
      });
      rfb.addEventListener('disconnect', () => {
        if (client.current === rfb) client.current = null;
        if (!stopped) retry(code);
      });
      client.current = rfb;
    };
    // After a connection ends with the relay's close code, or 0 for one that never opened.
    const retry = (code: number) => {
      if (code === POLICY) return setState('refused');
      if (code === TOO_OLD) return setState('tooOld');
      // A hidden page lets its watch lapse, so retrying would only be refused until it shows again.
      if (code === NOT_WATCHING || document.hidden) return wait();
      const delay = code === RECONNECT_NOW ? 0 : BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt += 1;
      setState('reconnecting');
      timer = setTimeout(() => (document.hidden ? wait() : void connect().catch(fail)), delay);
    };
    const fail = () => {
      if (!stopped) setState('failed');
    };
    void connect().catch(fail);
    return () => {
      stopped = true;
      detachInput();
      resized.disconnect();
      clearTimeout(timer);
      client.current?.disconnect();
      client.current = null;
      setState('idle');
    };
  }, [connectable, lease, computer, generation]);
  return { screen, state, problem, size };
}

// Keyboard shortcuts and pasting while in control (lib/live-view-input.ts). A capture listener on noVNC's container
// sees each keydown before noVNC's own listener on its canvas, and hides from noVNC the ones the page handles. A paste
// sets the computer's clipboard to its text or image through our server, because its VNC server takes the clipboard
// only once and only as Latin-1 text, then presses Ctrl+V there; keys pressed meanwhile wait behind it (keyQueue) and
// reach noVNC afterwards, replayed on its canvas. Returns the cleanup.
function attachInput(
  target: HTMLElement,
  client: { current: RFB | null },
  paste: { current: (content: Pasted) => Promise<unknown> },
  setProblem: (problem: string | null) => void,
  epoch: { current: number },
) {
  const onMac = mac();
  // The modifiers the user holds that noVNC sent, so chords leave them to noVNC.
  const held = new Set<string>();
  let stopped = false;
  // The pastes waiting for the browser's paste event to carry what they paste, oldest first.
  const takers: ((content: Pasted | null | Promise<Pasted | null>) => void)[] = [];
  const live = () => {
    const rfb = client.current;
    return rfb && !rfb.viewOnly ? rfb : null;
  };
  const queue = keyQueue(error => {
    if (error !== LOST && !stopped) setProblem((error as Error).message);
  });
  const send = (keysym: number, mods: { ctrl: boolean; shift: boolean }) => {
    const rfb = live();
    if (!rfb) return;
    for (const [sym, code, down] of chord(keysym, mods, held)) rfb.sendKey(sym, code, down);
    rfb.focus({ preventScroll: true });
  };
  // Hands a held key event to noVNC in its turn, as a copy this listener lets through (it is not trusted).
  const replay = (type: 'keydown' | 'keyup', event: KeyboardEvent) => {
    const init: KeyboardEventInit = {
      key: event.key,
      code: event.code,
      location: event.location,
      repeat: event.repeat,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      modifierCapsLock: event.getModifierState('CapsLock'),
      modifierNumLock: event.getModifierState('NumLock'),
      bubbles: true,
      cancelable: true,
    };
    return () => {
      if (!live()) return;
      if (type === 'keyup') held.delete(event.code);
      else if (MODIFIER_CODES.has(event.code)) held.add(event.code);
      target.querySelector('canvas')?.dispatchEvent(new KeyboardEvent(type, init));
    };
  };
  const startPaste = (shift: boolean) => {
    const at = epoch.current;
    let take!: (content: Pasted | null | Promise<Pasted | null>) => void;
    const content = new Promise<Pasted | null>(resolve => {
      take = resolve;
    });
    const forget = () => {
      const index = takers.indexOf(taker);
      if (index >= 0) takers.splice(index, 1);
    };
    // Some browsers fire no paste event on a canvas, so read the clipboard after a while instead: all of it, or in a
    // browser without read(), its text. Null when the user or the browser refuses.
    const timer = setTimeout(() => {
      forget();
      take(
        (navigator.clipboard.read
          ? navigator.clipboard.read().then(items => pastedContent(clipboardEntries(items)))
          : navigator.clipboard.readText()
        ).catch(() => null),
      );
    }, PASTE_EVENT_MS);
    const taker = (value: Pasted | null | Promise<Pasted | null>) => {
      clearTimeout(timer);
      forget();
      take(value);
    };
    takers.push(taker);
    queue.push(async () => {
      const current = () => {
        if (stopped || epoch.current !== at || !live()) throw LOST;
      };
      const value = await content;
      current();
      if (value === null) throw new Error('Allow clipboard access for this site to paste on your computer.');
      if (!value) return;
      const failure = await paste.current(value).then(
        () => null,
        (error: Error) => error,
      );
      current();
      if (failure) throw failure;
      setProblem(null);
      send(keysymOf('v', shift), { ctrl: true, shift });
    });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.isTrusted || !live()) return;
    const action = keyAction(event, onMac);
    if (action.kind === 'pass') {
      if (queue.hold('keydown', event.code, replay('keydown', event))) {
        event.stopPropagation();
        event.preventDefault();
      } else if (MODIFIER_CODES.has(event.code)) held.add(event.code);
      return;
    }
    event.stopPropagation();
    if (action.kind === 'send') {
      event.preventDefault();
      queue.push(() => send(action.keysym, action));
    } else if (action.kind === 'paste') {
      // No preventDefault, so the browser fires paste with this device's clipboard.
      startPaste(action.shift);
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (!event.isTrusted) return;
    if (queue.hold('keyup', event.code, replay('keyup', event))) {
      event.stopPropagation();
      event.preventDefault();
    } else held.delete(event.code);
  };
  const onBlur = () => held.clear();
  const onPaste = (event: ClipboardEvent) => {
    const taker = takers[0];
    if (!taker) return;
    event.preventDefault();
    taker(pastedContent(eventEntries(event.clipboardData)));
  };
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  document.addEventListener('paste', onPaste);
  return () => {
    stopped = true;
    queue.drop();
    for (const taker of [...takers]) taker('');
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('paste', onPaste);
  };
}

// Whether this lease's takeover ended without a hand-back from this page: the page was hidden or offline past the
// lapse, so the server let it go. A takeover moved to another tab shows as that tab's instead, and one that ended
// because the free minutes ran out or the computer was deleted has its own message.
function useLapsed(status: LiveViewStatus | undefined, handingBack: boolean) {
  const [lapsed, setLapsed] = useState(false);
  const held = useRef(false);
  useEffect(() => {
    if (status?.takeover?.mine) {
      held.current = true;
      setLapsed(false);
    } else if (held.current && status) {
      held.current = false;
      setLapsed(!status.takeover && !handingBack && !status.creditExhausted && status.computer !== 'none');
    }
  }, [status, handingBack]);
  return lapsed;
}

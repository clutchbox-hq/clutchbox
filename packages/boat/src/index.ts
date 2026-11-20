import { randomUUID } from 'node:crypto';
import { BoatApi, Configuration, ResponseError, type Sandbox, waitUntilReady } from '@boatdev/sdk';
import { PRIVATE_MEMORY_DIR } from '@clutchbox/apply/sandbox';
import {
  type ComputerProvider,
  type ComputerSession,
  type ComputerSize,
  DEFAULT_SCREEN,
  SCREEN_NAMES,
  type ScreenSize,
} from '@clutchbox/computer';
import {
  CommandExit,
  CommandTimeout,
  desktopSession,
  HELPER_DIR,
  type Machine,
  REVISION,
  STOP_CHROME,
} from '@clutchbox/e2b';
import { ENSURE_CHROME_MS, TYPE_KEY_DELAY_MS } from '@clutchbox/e2b/timing';
import { runSetup } from './setup.ts';
import {
  BOAT_REQUEST_MS,
  COMMAND_MARGIN_MS,
  COMMAND_MAX_SECONDS,
  READY_MS,
  SETTLE_MS,
  STOP_CHROME_SECONDS,
} from './timing.ts';

// Computers on Boat: a sandbox made from our saved snapshot (template.ts), whose desktop and Chrome the same helpers and
// session as on E2B control (@clutchbox/e2b's desktopSession), through Boat's command and file APIs.
//
// Where Boat differs from E2B:
// - No pause that keeps memory. A stop keeps the disk; a resume within about 10 minutes usually finds the machine
//   still running, and after that reboots it. The session says so (rebooted), so the server applies the whole capture.
// - Sandboxes are created with monitoring off, so Boat keeps no command output or history, and with no environment,
//   so a computer holds none of the account's secrets.
// - Cookie payloads and pastes go in PRIVATE_DIR, a tmpfs (Boat snapshots disks in the background), mounted on every
//   connect, since a reboot drops it. A marker in it tells a rebooted computer from a running one.
// - Ports are reached through Boat's hosted URLs, private by default, with the port's token in the query.
// - A stopped sandbox's disk is deleted after 14 days.

// The saved snapshot new computers start from: our helpers, x11vnc, and websockify on Boat's own desktop (template.ts).
export const SNAPSHOT = 'clutchbox-computer';
// Boat writes files only under /home/user and /tmp.
export const PRIVATE_DIR = '/tmp/clutchbox';
const UP_MARKER = `${PRIVATE_DIR}/up`;
// Chrome's profile locks, which name the host and process that held them: a Chrome that didn't quit (a stop on Boat's
// own timeout, or the snapshot's build) leaves them, and the next Chrome refuses a profile locked by another host. Only
// cleared while no Chrome runs.
export const CLEAR_CHROME_LOCKS =
  'pgrep -x chrome >/dev/null || rm -f /home/user/.config/agent-computers-chrome*/Singleton*';
// The screen last set, on disk, for a rebooted computer to come back at: Boat's desktop starts at 1920x1080.
const SCREEN_FILE = '/home/user/.config/clutchbox-screen';
// Boat's sizes match ours: small is 2 vCPU · 4 GB, default 4 vCPU · 8 GB.
const TYPES = { '1x': 'small', '2x': 'default' } as const satisfies Record<ComputerSize, string>;
const STOPPED = new Set(['archived']);
const STOPPING = new Set(['archiving']);
const FAILED = new Set(['error', 'cancelled']);

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));
const request = () => ({ signal: AbortSignal.timeout(BOAT_REQUEST_MS) });

// A Boat sandbox as a Machine. Commands run as `user` (with XAUTHORITY set for Boat's desktop), so `root` goes through
// its passwordless sudo, and DISPLAY through an export. Boat answers a command with its exit code, or timedOut.
export function boatMachine(boat: BoatApi, sandboxId: string): Machine {
  let endpoints: Map<number, Promise<{ url: string; headers: Record<string, string> }>> | undefined;
  const machine: Machine = {
    async run(command, { user, display, timeoutMs }) {
      const script = display ? `export DISPLAY=:0\n${command}` : command;
      const full = user === 'root' ? `sudo -n sh -c ${quote(script)}` : script;
      const timeoutSeconds = Math.min(COMMAND_MAX_SECONDS, seconds(timeoutMs));
      let result: Awaited<ReturnType<BoatApi['command']>>;
      try {
        result = await boat.command(
          { sandboxId, command: full, timeoutSeconds },
          { signal: AbortSignal.timeout(timeoutSeconds * 1000 + COMMAND_MARGIN_MS) },
        );
      } catch (error) {
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
          throw new CommandTimeout();
        throw error;
      }
      const { exitCode, stdout, stderr, timedOut } = result as {
        exitCode: number | null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      };
      if (timedOut) throw new CommandTimeout();
      if (exitCode !== 0) throw new CommandExit(exitCode ?? -1, stdout, stderr);
      return { stdout, stderr };
    },
    async write(files, timeoutMs) {
      const signal = AbortSignal.timeout(timeoutMs);
      for (const { path, data } of files)
        await boat.writeFile(
          typeof data === 'string'
            ? { sandboxId, path, content: data, encoding: 'utf8' }
            : { sandboxId, path, content: Buffer.from(data).toString('base64'), encoding: 'base64' },
          { signal },
        );
    },
    async remove(path, timeoutMs) {
      await boat.deleteFile({ sandboxId, path }, { signal: AbortSignal.timeout(timeoutMs) });
    },
    async screenshot() {
      const { stdout } = await machine.run('import -window root png:- | base64 -w0', {
        display: true,
        timeoutMs: 15_000,
      });
      return new Uint8Array(Buffer.from(stdout.trim(), 'base64'));
    },
    // From a file in memory, never the command line.
    async type(text) {
      const file = `${PRIVATE_DIR}/type-${randomUUID()}`;
      await machine.write([{ path: file, data: text }], BOAT_REQUEST_MS);
      await machine.run(
        `xdotool type --delay ${TYPE_KEY_DELAY_MS} --file ${file}; status=$?; rm -f ${file}; exit $status`,
        { display: true, timeoutMs: 10_000 + text.length * TYPE_KEY_DELAY_MS },
      );
    },
    async setTimeout(timeoutMs) {
      await boat.update({ sandboxId, ttlSeconds: seconds(timeoutMs) }, request());
    },
    // Boat keeps a port's URL and token across stops and resumes, so each is asked for once per session.
    endpoint(port) {
      endpoints ??= new Map();
      let endpoint = endpoints.get(port);
      if (!endpoint) {
        endpoint = boat.hostPort({ sandboxId, port }, request()).then(hosted => {
          if (!hosted.url) throw new Error('Boat hosted no URL for the port');
          const url = new URL(hosted.url);
          const token = url.searchParams.get('_token');
          if (!token) throw new Error('computer accepts public traffic');
          // The token goes in the query: Boat's proxy refuses its cookie on a WebSocket with an Origin, which the relays send.
          return { url: `wss://${url.host}/?_token=${encodeURIComponent(token)}`, headers: {} };
        });
        endpoint.catch(() => endpoints?.delete(port));
        endpoints.set(port, endpoint);
      }
      return endpoint;
    },
    isPrivate: true,
  };
  return machine;
}

// Mounts the private directory unless a mount is there, starts Chrome unless it runs (a stop quits it), and says whether
// the machine rebooted since the last call: the marker in the mount is gone with it.
async function prepare(machine: Machine): Promise<{ rebooted: boolean }> {
  const { stdout } = await machine.run(
    `sh -c ${quote(PRIVATE_MEMORY_DIR)} sh ${PRIVATE_DIR} || exit 1; if [ -e ${UP_MARKER} ]; then echo up; else : > ${UP_MARKER}; echo rebooted; fi; ${CLEAR_CHROME_LOCKS}; ${HELPER_DIR}/ensure-chrome.sh >/dev/null 2>&1`,
    { display: true, timeoutMs: ENSURE_CHROME_MS },
  );
  return { rebooted: stdout.trim() === 'rebooted' };
}

// The desktop session, which keeps the screen it sets for after a reboot, and on a rebooted computer sets it again.
async function boatSession(machine: Machine, rebooted: boolean): Promise<ComputerSession> {
  const session = desktopSession(machine, { privateDir: PRIVATE_DIR, pasteDir: PRIVATE_DIR, rebooted });
  if (rebooted) {
    const { stdout } = await machine.run(`cat ${SCREEN_FILE} 2>/dev/null; true`, { timeoutMs: 10_000 });
    const kept = stdout.trim() as ScreenSize;
    await session.setScreen(SCREEN_NAMES.includes(kept) ? kept : DEFAULT_SCREEN);
  }
  return {
    ...session,
    async setScreen(screen) {
      const set = await session.setScreen(screen);
      if (set) await machine.write([{ path: SCREEN_FILE, data: screen }], BOAT_REQUEST_MS);
      return set;
    },
  };
}

const status = (error: unknown) => (error instanceof ResponseError ? error.response.status : undefined);
const missingSnapshot = async (error: unknown) =>
  status(error) === 404 &&
  (
    (await (error as ResponseError).response
      .clone()
      .json()
      .catch(() => null)) as { code?: string } | null
  )?.code === 'snapshot_not_found';

// Computers on the Boat account of BOAT_API_KEY, or of `apiKey`, made from `snapshot`.
export function boatComputerProvider({
  apiKey = process.env.BOAT_API_KEY,
  snapshot = process.env.BOAT_COMPUTER_SNAPSHOT || SNAPSHOT,
  basePath = 'https://boat.dev/api/v1',
}: {
  apiKey?: string | undefined;
  snapshot?: string;
  basePath?: string;
} = {}): ComputerProvider {
  if (!apiKey) throw new Error('BOAT_API_KEY is required.');
  const boat = new BoatApi(new Configuration({ basePath, accessToken: apiKey }));
  const get = async (sandboxId: string) => (await boat.get({ sandboxId }, request())).sandbox;
  // A sandbox that is stopping can only resume once it has stopped.
  const settled = async (sandboxId: string): Promise<Sandbox> => {
    const end = Date.now() + SETTLE_MS;
    for (;;) {
      const sandbox = await get(sandboxId);
      if (!STOPPING.has(sandbox.state) || Date.now() > end) return sandbox;
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  };
  return {
    name: 'boat',
    revision: REVISION,
    // Each computer's sandbox is named by its public ID.
    async find(computerId) {
      let cursor: string | null | undefined;
      do {
        const page = await boat.sandboxes({ limit: 100, ...(cursor ? { cursor } : {}) }, request());
        const found = page.sandboxes.find(sandbox => sandbox.name === computerId && !FAILED.has(sandbox.state));
        if (found) return found.id;
        cursor = page.pageInfo?.hasMore ? page.pageInfo.nextCursor : null;
      } while (cursor);
      return null;
    },
    // Boat stops the sandbox timeoutMs after the call unless called again. A computer that fails to start is deleted, since nothing on it is worth keeping.
    async create(computerId, timeoutMs, size) {
      const options = {
        type: TYPES[size],
        name: computerId,
        ttlSeconds: seconds(timeoutMs),
        noEnv: true,
        monitoring: false,
      };
      // Without the snapshot (a new account, or one on Boat's trial, which saves none), a default sandbox gets SETUP:
      // the same computer, about a minute slower to make.
      let fromSnapshot = true;
      const { sandbox } = await boat.create({ from: snapshot, ...options }, request()).catch(async error => {
        if (!(await missingSnapshot(error))) throw error;
        fromSnapshot = false;
        return boat.create(options, request());
      });
      try {
        await waitUntilReady(boat, sandbox.id, { timeoutMs: READY_MS });
        if (!fromSnapshot) await runSetup(boat, sandbox.id, AbortSignal.timeout(COMMAND_MAX_SECONDS * 1000));
        const machine = boatMachine(boat, sandbox.id);
        await prepare(machine);
        await (await boatSession(machine, false)).setScreen(DEFAULT_SCREEN);
      } catch (error) {
        await boat.deleteSandbox({ sandboxId: sandbox.id, xAsciiConfirmDelete: sandbox.id }, request()).catch(() => {});
        throw error;
      }
      return sandbox.id;
    },
    // Resumes a stopped computer; on a running one it only ever extends the timeout.
    async connect(sandboxId, timeoutMs) {
      const sandbox = await settled(sandboxId);
      if (FAILED.has(sandbox.state)) throw new Error(`Boat sandbox ${sandbox.state}`);
      if (STOPPED.has(sandbox.state) || STOPPING.has(sandbox.state)) {
        await boat.resume({ sandboxId, ttlSeconds: seconds(timeoutMs) }, request());
        await waitUntilReady(boat, sandboxId, { timeoutMs: READY_MS });
      } else if (!sandbox.archiveAfter || sandbox.archiveAfter.getTime() < Date.now() + timeoutMs) {
        await boat.update({ sandboxId, ttlSeconds: seconds(timeoutMs) }, request());
      }
      const machine = boatMachine(boat, sandboxId);
      const { rebooted } = await prepare(machine);
      return boatSession(machine, rebooted);
    },
    // Chrome quits first, so the cookies it holds reach disk; a stopped or stopping computer is left as it is.
    async pause(sandboxId) {
      const sandbox = await get(sandboxId);
      if (STOPPED.has(sandbox.state) || STOPPING.has(sandbox.state)) return;
      await boatMachine(boat, sandboxId)
        .run(`set -- chrome ${STOP_CHROME_SECONDS}\n${STOP_CHROME}`, { timeoutMs: (STOP_CHROME_SECONDS + 5) * 1000 })
        .catch(() => {});
      try {
        await boat.stop({ sandboxId }, request());
      } catch (error) {
        if (status(error) !== 409) throw error;
      }
    },
    async setTimeout(sandboxId, timeoutMs) {
      await boat.update({ sandboxId, ttlSeconds: seconds(timeoutMs) }, request());
    },
    async kill(sandboxId) {
      try {
        await boat.deleteSandbox({ sandboxId, xAsciiConfirmDelete: sandboxId }, request());
      } catch (error) {
        if (status(error) !== 404) throw error;
      }
    },
  };
}

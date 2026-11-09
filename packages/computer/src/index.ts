import type { CdpCookieParam } from '@clutchbox/apply';
import { z } from 'zod';

// What a computer offers, whatever runs it: a provider creates, resumes, and pauses computers, and a session
// controls one. Adapters implement these for a sandbox provider (packages/e2b).
// The screen sizes a computer switches between (setScreen), named by their pixels; screenshots and actions use the
// screen's coordinates. A new computer starts at DEFAULT_SCREEN. A desktop can't grow past the size it started at, so
// providers start it at the largest; one started before these sizes stays at its own until it is reset.
export const SCREENS = {
  '1440x900': { width: 1440, height: 900 },
  '1280x1024': { width: 1280, height: 1024 },
  '1920x1200': { width: 1920, height: 1200 },
} as const;
export type ScreenSize = keyof typeof SCREENS;
export const SCREEN_NAMES = Object.keys(SCREENS) as [ScreenSize, ...ScreenSize[]];
export const DEFAULT_SCREEN: ScreenSize = '1440x900';
// A screenshot's size, read from its PNG header: the screen it shows, whatever size the computer runs at. Null for
// anything but a PNG.
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  const header = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
  if (png.length < 24 || header.some((byte, i) => png[i] !== byte)) return null;
  const view = new DataView(png.buffer, png.byteOffset, 24);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
// A key name (Return, ctrl, F5, a) or a chord of them joined by +, in characters a shell passes through unquoted:
// adapters may hand keys to a command line, as E2B's xdotool does. Text, symbols included, goes through `type`.
export const keyNamePattern = /^[A-Za-z0-9_+.,=/:-]+$/;
const keyName = z
  .string()
  .min(1)
  .max(40)
  .regex(keyNamePattern, 'A key name, such as Return, ctrl, or a; type text with type.');
export const actionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('click'),
      x: z.int().min(0),
      y: z.int().min(0),
      button: z.enum(['left', 'right', 'middle']).default('left'),
      double: z.boolean().default(false),
    })
    .strict(),
  z.object({ type: z.literal('move'), x: z.int().min(0), y: z.int().min(0) }).strict(),
  z
    .object({
      type: z.literal('drag'),
      from: z.tuple([z.int().min(0), z.int().min(0)]),
      to: z.tuple([z.int().min(0), z.int().min(0)]),
    })
    .strict(),
  z
    .object({
      type: z.literal('scroll'),
      x: z.int().min(0).optional(),
      y: z.int().min(0).optional(),
      direction: z.enum(['up', 'down']),
      amount: z.int().min(1).max(20).default(3),
    })
    .strict(),
  z.object({ type: z.literal('type'), text: z.string().min(1).max(2000) }).strict(),
  z
    .object({
      type: z.literal('key'),
      keys: z.union([keyName, z.array(keyName).min(1).max(5)]),
    })
    .strict(),
  z.object({ type: z.literal('wait'), ms: z.int().min(1).max(5000) }).strict(),
]);
export type ComputerAction = z.infer<typeof actionSchema>;
// A Chrome profile on a computer: its own user data directory, so its cookies and storage stay apart from every other
// profile's. Names are the caller's, in characters a shell passes through unquoted. FIRST_PROFILE is the directory a
// computer's Chrome ran before profiles, which the first profile a computer gets keeps.
// Computer sizes. People see each by its spec (2 vCPU · 4 GB, sizeName); the keys are stored identifiers only. Two CPUs
// and 4 GB, the default, run Chrome on real pages; the larger size is for heavier sites and more tabs. An 8 CPU size
// was dropped unused: E2B caps memory at 8 GB, so it added CPUs that Chrome alone rarely keeps busy. A computer keeps
// the size it was created at.
export const COMPUTER_SIZES = {
  '1x': { cpuCount: 2, memoryMB: 4096 },
  '2x': { cpuCount: 4, memoryMB: 8192 },
} as const;
export type ComputerSize = keyof typeof COMPUTER_SIZES;
export const COMPUTER_SIZE_NAMES = Object.keys(COMPUTER_SIZES) as [ComputerSize, ...ComputerSize[]];
// A size as people see it, by its spec.
export const sizeName = (size: ComputerSize) =>
  `${COMPUTER_SIZES[size].cpuCount} vCPU · ${COMPUTER_SIZES[size].memoryMB / 1024} GB`;
export const PROFILE_PATTERN = /^[a-z0-9_]{1,64}$/;
export const FIRST_PROFILE = 'default';
// The platform a computer's Chrome presents to sites in place of its own Linux (setPlatform): the synced browser's,
// as its client hints report it. The version a computer presents is always its own Chrome's, so the claims match the
// engine. Only desktop platforms whose user agent string has a fixed token are presented.
export const platformOverrideSchema = z.object({
  platform: z.enum(['macOS', 'Windows']),
  // As Chrome reports it: macOS 26.6.2, Windows 19.0.0 (its UniversalApiContract version), or empty.
  platformVersion: z.string().regex(/^(\d{1,5}(\.\d{1,5}){0,3})?$/),
  architecture: z.enum(['', 'x86', 'arm']),
  bitness: z.enum(['', '32', '64']),
  wow64: z.boolean(),
});
export type PlatformOverride = z.infer<typeof platformOverrideSchema>;
export type ExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
};
// What live view's paste puts on the computer's clipboard: text, or a PNG image.
export type ClipboardContent = string | { png: Uint8Array<ArrayBuffer> };

export interface ComputerSession {
  screenshot(): Promise<Uint8Array>;
  act(action: ComputerAction): Promise<void>;
  cdp(input: {
    method: string;
    params?: Record<string, unknown> | undefined;
    targetId?: string | undefined;
  }): Promise<string>;
  exec(input: { command: string; cwd?: string | undefined; timeoutSeconds: number }): Promise<ExecResult>;
  // Closes every browser tab but one blank one. Never starts the browser.
  closeTabs(): Promise<void>;
  // The provider pauses the computer timeoutMs from now unless called again; may shorten the timeout.
  setTimeout(timeoutMs: number): Promise<void>;
  // Brings a computer made from an older template to the provider's revision, restarting the browser (its
  // profile and sign-ins stay, its tabs close). Nothing may run on the computer later than budgetMs after.
  refresh(budgetMs: number): Promise<'current' | 'refreshed'>;
  // Sets the system time zone (a valid IANA name) and restarts a running Chrome on another zone, since Chrome keeps the
  // zone it started with: gracefully, so its profile and lasting cookies stay, but its tabs and session cookies don't.
  // Done, or failed, within budgetMs.
  setTimeZone(timeZone: string, budgetMs: number): Promise<void>;
  // Makes `languages` (language tags, most preferred first) the preferred languages of Chrome on `profile`: at once
  // when Chrome runs it, and from its next start otherwise. Chrome's own locale, which pages' Intl follows, changes only
  // at that next start. Done, or failed, within budgetMs.
  setLanguages(profile: string, languages: string[], budgetMs: number): Promise<void>;
  // Makes Chrome on `profile` present `platform` to sites (its user agent, client hints, and navigator.platform), or
  // its own with null: at once when Chrome runs it, without a restart, and from every later start. Done, or failed,
  // within budgetMs.
  setPlatform(profile: string, platform: PlatformOverride | null, budgetMs: number): Promise<void>;
  // Switches the screen to `screen`; windows and the browser keep running, and Chrome stays maximized. False, changing
  // nothing, on a computer whose desktop started smaller than the screen.
  setScreen(screen: ScreenSize): Promise<boolean>;
  // Runs Chrome on `profile` (PROFILE_PATTERN), the one Chrome every other method uses until the next call: a Chrome on
  // another profile is stopped gracefully first, so its cookies reach disk, and its tabs close. A computer runs
  // FIRST_PROFILE until told otherwise. Done, or failed, within budgetMs; a failure leaves no Chrome on the wrong profile.
  useProfile(profile: string, budgetMs: number): Promise<void>;
  // Replaces every cookie of clearSites, then sets `cookies` (an expired one deletes its match); other
  // sites' cookies are kept. Refused unless Chrome runs `profile`, so one profile's cookies never reach another. Nothing
  // may change cookies later than budgetMs after the call, even when it fails.
  syncCookies(input: {
    profile: string;
    clearSites: string[];
    cookies: CdpCookieParam[];
    budgetMs: number;
  }): Promise<{ kept: number; cleared: number; set: number }>;
  // Starts live view's stream unless it runs (x11vnc on the display, behind websockify) and says where to reach it:
  // a WebSocket URL and the headers it needs, which carry the provider's traffic token, so they never leave the
  // server. Refuses a computer that accepts public traffic. Done within budgetMs.
  stream(budgetMs: number): Promise<{ url: string; headers: Record<string, string> }>;
  // Starts Chrome and a bridge to its DevTools unless they run, and says where to reach the browser's CDP WebSocket, as
  // stream() does for live view: the headers carry the provider's traffic token, so they never leave the server.
  // Refuses a computer that accepts public traffic. Done within budgetMs.
  cdpEndpoint(budgetMs: number): Promise<{ url: string; headers: Record<string, string> }>;
  // Makes `content` the computer's clipboard, owned anew, so the next paste there gets it (live view's paste). Done, or
  // failed, within budgetMs.
  setClipboard(content: ClipboardContent, budgetMs: number): Promise<void>;
  // Whether the computer refuses traffic without the provider's token. One created before that accepts
  // public traffic until it is reset, and live view refuses it.
  readonly isPrivate: boolean;
}
// Thrown by a provider on an account its owner brought (such as an organization's own E2B API key) when the provider
// refuses that account: the key was revoked, or the account can't pay. Only someone who manages the account can fix it.
export class ProviderAccountRefused extends Error {
  readonly code = 'provider_account_refused';
  constructor(cause?: unknown) {
    super('The provider refused the account', { cause });
    this.name = 'ProviderAccountRefused';
  }
}
export interface ComputerProvider {
  // Who runs the computers, as agents are told, such as "e2b".
  name: string;
  // The helpers and browser setup a computer should run; changes when the provider's do (refresh).
  revision: string;
  // Reconciles a create whose response was lost: provider metadata carries the computer's public ID.
  find(computerId: string): Promise<string | null>;
  // timeoutMs: the provider pauses the computer this long after the call unless called again.
  create(computerId: string, timeoutMs: number, size: ComputerSize): Promise<string>;
  // Resumes a paused computer; on a running one it only ever extends the timeout.
  connect(sandboxId: string, timeoutMs: number): Promise<ComputerSession>;
  pause(sandboxId: string): Promise<void>;
  // The provider pauses a running computer timeoutMs from now, shorter or longer than before, without waking a
  // paused one the way connect would. Bounded: callers hold the computer row lock across it.
  setTimeout(sandboxId: string, timeoutMs: number): Promise<void>;
  kill(sandboxId: string): Promise<void>;
}

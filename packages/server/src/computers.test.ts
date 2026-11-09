import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { type ClipboardContent, FIRST_PROFILE, ProviderAccountRefused } from '@clutchbox/computer';
import { PGlite } from '@electric-sql/pglite';
import { desc, eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDGE_ON_WINDOWS, saveFromBrowser, syncingBrowser } from './browser-fixtures.ts';
import { recordBrowserEnvironment, removeBrowser } from './browsers.ts';
import { bundle, cookie } from './capture-fixtures.ts';
import { deleteCaptures } from './captures.ts';
import {
  accountRefusal,
  type Caller,
  type Computers,
  closeComputerSession,
  computerView,
  connectLiveView,
  createPausedComputer,
  DEFAULT_MAX_COMPUTERS,
  deleteAllComputers,
  deleteComputer,
  handBackComputer,
  listComputers,
  liveViewAccess,
  liveViewHeartbeat,
  liveViewStatus,
  MAX_CLIPBOARD_BYTES,
  MAX_CLIPBOARD_IMAGE_BYTES,
  openComputerSession,
  platformOverrideOf,
  resetOrganizationComputers,
  SESSION_ID_PATTERN,
  setComputerScreen,
  setComputerSize,
  setLiveViewClipboard,
  sweepAbandoned,
  takeOverComputer,
  useComputerSession,
} from './computers.ts';
import type { Database } from './database.ts';
import { databaseSchema } from './database-schema.ts';
import { fakeComputerProvider } from './fake-computer-provider.ts';
import { heartbeat, heartbeatSchema } from './heartbeat.ts';
import { type Metering, type MeteringRefusal, noLimits, noMetering } from './hooks.ts';
import { newPublicId } from './ids.ts';
import { revokeMcpGrant, revokeMcpGrants } from './mcp.ts';
import { membership, person } from './member-fixtures.ts';
import type { Member } from './organizations.ts';
import * as schema from './schema.ts';
import { setTimeZone } from './time-zones.ts';

let pg: PGlite;
let db: Database;
let fake: ReturnType<typeof fakeComputerProvider>;
// The metering hook as the computer service sees it: a refusal tests turn on.
let refusal: MeteringRefusal | null;
const metering: Metering = { ...noMetering, refusal: async () => refusal };
let computers: Computers;
const user = (id: string) => person(db, id);
const join = (userId: string, organizationId: string) => membership(db, userId, organizationId);
// The member's consent for an agent, bound to their membership as the consent page binds it.
const grant = async (member: Member, clientId: string) => {
  const [membership] = await db
    .select({ publicId: schema.memberships.publicId })
    .from(schema.memberships)
    .where(eq(schema.memberships.id, member.membershipId));
  await db.insert(schema.oauthConsent).values({
    id: randomUUID(),
    clientId,
    userId: member.userId,
    referenceId: membership!.publicId,
    scopes: ['mcp:tools'],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};
const caller = (member: Member, clientId = 'client', guard?: Caller['guard']): Caller => ({
  ...member,
  clientId,
  guard,
});
// Opens and ends the open's own call, as the MCP layer does: a new computer, or with computerId (or the caller's own
// sessionId) a reopen.
const open = async (member: Member, clientId = 'client', sessionId?: string, computerId?: string) => {
  const opened = await openComputerSession(db, computers, caller(member, clientId), { sessionId, computerId });
  if ('error' in opened) throw new Error(opened.error);
  await opened.done();
  return opened;
};
const use = async (member: Member, sessionId: string, clientId = 'client') => {
  const handle = await useComputerSession(db, computers, caller(member, clientId), sessionId);
  if ('error' in handle) return handle;
  await handle.done();
  return handle;
};
const sessions = () => db.select().from(schema.computerSessions);
const sessionRow = async (publicId: string) =>
  (await db.select().from(schema.computerSessions).where(eq(schema.computerSessions.publicId, publicId)))[0]!;
const computerRows = () => db.select().from(schema.computers);
// The newest computers row.
const computerRow = async () =>
  (await db.select().from(schema.computers).orderBy(desc(schema.computers.id)).limit(1))[0]!;
const rowOf = async (publicId: string) =>
  (await db.select().from(schema.computers).where(eq(schema.computers.publicId, publicId)))[0]!;
// The newest provider computer.
const sandbox = () => [...fake.sandboxes.values()].at(-1)!;
const sandboxOf = async (publicId: string) => fake.sandboxes.get((await rowOf(publicId)).sandboxId!)!;
// A computer's profiles (computer_profiles), oldest first; the first is the test browser's.
const profilesOf = (owner: { computerId: number }) =>
  db
    .select()
    .from(schema.computerProfiles)
    .where(eq(schema.computerProfiles.computerId, owner.computerId))
    .orderBy(schema.computerProfiles.id);
// What the newest computer applied to its first profile.
const applied = async () => (await profilesOf({ computerId: (await computerRow()).id }))[0]!;
// The member's computer time as booked: its rows, the seconds run by UTC day, and the pauses.
const booked = (member: Member) =>
  db
    .select()
    .from(schema.computerTime)
    .where(eq(schema.computerTime.membershipId, member.membershipId))
    .orderBy(schema.computerTime.id);
const used = async (member: Member) => {
  const days = new Map<string, number>();
  for (const row of (await booked(member)).filter(row => row.runSeconds > 0))
    days.set(row.day, (days.get(row.day) ?? 0) + row.runSeconds);
  return [...days];
};
const pausesBooked = async (member: Member) => (await booked(member)).reduce((sum, row) => sum + row.pauses, 0);
const at = (iso: string) => vi.setSystemTime(new Date(iso));
// Migrate once per file and give each test a clone, which is much faster than a new database.
let template: PGlite;
beforeAll(async () => {
  template = new PGlite();
  await migrate(drizzle(template, { schema: databaseSchema }), {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
});
afterAll(() => template.close());
beforeEach(async () => {
  pg = (await template.clone()) as PGlite;
  db = drizzle(pg, { schema: databaseSchema }) as unknown as Database;
  fake = fakeComputerProvider();
  refusal = null;
  computers = { provider: fake.provider, metering };
  // Computer sessions reference their OAuth client.
  await db
    .insert(schema.oauthClient)
    .values(
      ['client', 'claude', 'chatgpt', 'other', 'next'].map(clientId => ({ id: clientId, clientId, redirectUris: [] })),
    );
  vi.stubEnv('CAPTURE_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await pg.close();
});

describe('deleting all computers', () => {
  it("deletes every one of the member's computers, keeps synced data, and lets the next open start fresh", async () => {
    const a = await user('a');
    await saveFromBrowser(db, a, bundle([cookie()]));
    const first = await open(a);
    await open(a, 'chatgpt');
    expect(await deleteAllComputers(db, { provider: fake.provider }, a)).toBe(2);
    expect(fake.calls.kill).toBe(2);
    expect(fake.sandboxes.size).toBe(0);
    expect(await computerRows()).toHaveLength(0);
    expect(await useComputerSession(db, computers, caller(a), first.sessionId)).toMatchObject({
      error: 'session_not_found',
    });
    expect(await deleteAllComputers(db, { provider: fake.provider }, a)).toBe(0);
    // The synced sign-ins stay, and reach the next computer.
    const next = await open(a);
    expect(next.computer.created).toBe(true);
    expect(next.sync).toMatchObject({ status: 'applied', sitesUpdated: 1 });
  });
  it('kills the computer an in-flight open creates after a delete, instead of orphaning it', async () => {
    const a = await user('a');
    fake.slowCreate(200);
    const opening = openComputerSession(db, computers, caller(a));
    await vi.waitFor(async () => {
      expect(fake.calls.create).toBe(1);
      expect(await computerRows()).toHaveLength(1);
    });
    await deleteAllComputers(db, { provider: fake.provider }, a);
    await expect(opening).rejects.toThrow('deleted while it was created');
    expect(fake.sandboxes.size).toBe(0);
    expect(await computerRows()).toHaveLength(0);
    fake.slowCreate(0);
    await open(a);
    expect(fake.sandboxes.size).toBe(1);
  });
});

describe('sizes and screens', () => {
  it("makes a computer at the member's size and screen, and a change affects only new computers", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const b = await user('b');
    await setComputerSize(db, a, '2x');
    await setComputerScreen(db, a, '1920x1200');
    const first = await open(a);
    expect(fake.calls.sizes).toEqual(['2x']);
    expect(await rowOf(first.computer.id)).toMatchObject({ size: '2x' });
    expect((await sandboxOf(first.computer.id)).screen).toEqual({ width: 1920, height: 1200 });
    expect(await computerView(db, computers, a)).toMatchObject({ size: '2x', screen: '1920x1200' });
    // Its running time is charged at its size.
    at('2026-10-20T12:00:30Z');
    expect(await use(a, first.sessionId)).not.toHaveProperty('error');
    expect(new Set((await booked(a)).map(row => row.size))).toEqual(new Set(['2x']));
    // Another member keeps the defaults.
    const other = await open(b);
    expect(fake.calls.sizes).toEqual(['2x', '1x']);
    expect((await sandboxOf(other.computer.id)).screen).toEqual({ width: 1440, height: 900 });
    // Changing them resets nothing: the existing computer keeps its own, reopened or not.
    const screensBefore = fake.calls.screens.length;
    await setComputerSize(db, a, '1x');
    await setComputerScreen(db, a, '1280x1024');
    expect(fake.calls.kill).toBe(0);
    await open(a, 'client', first.sessionId);
    expect(fake.calls.screens).toHaveLength(screensBefore);
    expect(await rowOf(first.computer.id)).toMatchObject({ size: '2x' });
    expect((await sandboxOf(first.computer.id)).screen).toEqual({ width: 1920, height: 1200 });
    // The next new one starts at the new choices.
    const next = await open(a, 'chatgpt');
    expect(await rowOf(next.computer.id)).toMatchObject({ size: '1x' });
    expect((await sandboxOf(next.computer.id)).screen).toEqual({ width: 1280, height: 1024 });
  });
  it('still opens a new computer when its screen cannot be set', async () => {
    const a = await user('a');
    await setComputerScreen(db, a, '1920x1200');
    fake.failScreen();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const opened = await open(a);
    expect(error).toHaveBeenCalled();
    expect((await sandboxOf(opened.computer.id)).screen).toEqual({ width: 1440, height: 900 });
  });
});

describe('memberships', () => {
  it("gives each of a person's memberships its own computers, sessions, live view, usage, and deletion", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    // The same person in a second organization, as a member.
    const team = await join(a.userId, (await user('b')).organizationId);
    const personal = await open(a);
    const work = await open(team);
    expect(fake.calls.create).toBe(2);
    const rows = await computerRows();
    expect(rows.map(row => row.membershipId).sort()).toEqual([a.membershipId, team.membershipId].sort());
    // A session or computer works only for the membership that opened it, though the person and the agent are the same.
    for (const [member, sessionId] of [
      [team, personal.sessionId],
      [a, work.sessionId],
    ] as const)
      for (const action of [useComputerSession, closeComputerSession])
        expect(await action(db, computers, caller(member), sessionId)).toMatchObject({ error: 'session_not_found' });
    expect(await openComputerSession(db, computers, caller(team), { computerId: personal.computer.id })).toMatchObject({
      error: 'computer_not_found',
    });
    expect(await listComputers(db, computers, team)).toEqual([
      expect.objectContaining({ computerId: work.computer.id }),
    ]);
    // Usage is charged to the membership whose computer ran.
    at('2026-10-20T12:00:30Z');
    expect(await use(a, personal.sessionId)).not.toHaveProperty('error');
    expect(await used(a)).toEqual([['2026-10-20', 30]]);
    expect(await used(team)).toEqual([]);
    // Live view: taking over the team computer leaves the personal one to its agent.
    const page = randomUUID();
    const teamComputer = { computerId: work.computer.id };
    expect(await takeOverComputer(db, computers, team, page, teamComputer)).toMatchObject({ takeover: { mine: true } });
    expect(await use(team, work.sessionId)).toMatchObject({ error: 'user_in_control' });
    expect(await use(a, personal.sessionId)).not.toHaveProperty('error');
    expect(await liveViewAccess(db, team, page, undefined, teamComputer)).toBe('control');
    expect(await liveViewAccess(db, a, page, undefined, teamComputer)).toBe('none');
    expect(await setLiveViewClipboard(db, { provider: fake.provider }, a, page, 'x', teamComputer)).toBe(
      'not_in_control',
    );
    // Deleting one membership's computers leaves the other's and its session.
    expect(await deleteAllComputers(db, { provider: fake.provider }, team)).toBe(1);
    expect((await computerRows()).map(row => row.membershipId)).toEqual([a.membershipId]);
    expect(await use(a, personal.sessionId)).not.toHaveProperty('error');
    expect(await computerView(db, computers, team)).toMatchObject({ computers: [] });
  });
});

describe('provider accounts', () => {
  // Organization a on a provider account of its own; b on the deployment's.
  const ownAccount = async () => {
    const own = fakeComputerProvider({ account: 'own-' });
    const [a, b] = [await user('a'), await user('b')];
    const accounts = vi.fn(async (_db: Database, organizationId: string) =>
      organizationId === a.organizationId ? own.provider : null,
    );
    computers = { provider: fake.provider, metering, accounts };
    return { own, a, b, accounts };
  };
  it("runs every computer of an organization on its own account, and the others' on the deployment's", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-01T12:00:00Z');
    const { own, a, b } = await ownAccount();
    const mine = await open(a);
    const theirs = await open(b);
    expect(mine.computer.account).toBe('organization');
    expect(theirs.computer.account).toBe('deployment');
    expect(own.calls.create).toBe(1);
    expect(fake.calls.create).toBe(1);
    at('2026-10-01T12:00:30Z');
    expect(await use(a, mine.sessionId)).not.toHaveProperty('error');
    expect(await computerView(db, computers, a)).toMatchObject({ account: 'organization' });
    expect(await computerView(db, computers, b)).toMatchObject({ account: 'deployment' });
    // Live view connects on the organization's account.
    const page = randomUUID();
    const target = { computerId: mine.computer.id };
    await takeOverComputer(db, computers, a, page, target);
    expect(await connectLiveView(db, computers, a, page, target)).toHaveProperty('isPrivate', true);
    await handBackComputer(db, computers, a, page, target);
    // Its time is still metered, on its own account.
    expect(await used(a)).toEqual([['2026-10-01', 30]]);
    expect((await booked(a)).map(row => row.account)).toEqual(['organization']);
    // Deleting a computer, and replacing one at the cap, happen on the organization's account.
    await closeComputerSession(db, computers, caller(a), mine.sessionId);
    expect(await deleteComputer(db, computers, a, mine.computer.id)).toEqual({ deleted: true });
    expect(own.sandboxes.size).toBe(0);
    expect(own.calls.kill).toBe(1);
    expect(fake.sandboxes.size).toBe(1);
    computers = { ...computers, limits: { ...noLimits, computers: async () => 1 } };
    const first = await open(a);
    await closeComputerSession(db, computers, caller(a), first.sessionId);
    await open(a);
    expect(own.sandboxes.size).toBe(1);
    expect(own.calls.kill).toBe(2);
    expect(await deleteAllComputers(db, computers, a)).toBe(1);
    expect(own.sandboxes.size).toBe(0);
    expect(fake.sandboxes.size).toBe(1);
  });
  it("resets an organization's computers on the account they ran on, with the switch in the same transaction", async () => {
    const { own, a, b } = await ownAccount();
    const teammate = await join((await user('c')).userId, a.organizationId);
    await open(a);
    await open(teammate);
    await open(b);
    let switched = false;
    await resetOrganizationComputers(db, own.provider, a.organizationId, async tx => {
      expect(await tx.select().from(schema.computers)).toHaveLength(1);
      switched = true;
    });
    expect(switched).toBe(true);
    expect(own.sandboxes.size).toBe(0);
    expect((await computerRows()).every(row => row.membershipId === b.membershipId)).toBe(true);
    expect(fake.sandboxes.size).toBe(1);
    // The next open makes a new computer.
    expect((await open(a)).computer.created).toBe(true);
    expect(own.calls.create).toBe(3);
  });
  it("answers a refusal of the organization's own account with its own failure", async () => {
    const { own, a } = await ownAccount();
    vi.spyOn(own.provider, 'create').mockRejectedValueOnce(new ProviderAccountRefused());
    const error = await openComputerSession(db, computers, caller(a)).catch(thrown => thrown);
    expect(accountRefusal(error)).toMatchObject({ error: 'provider_account_refused' });
    expect(accountRefusal(new Error('timeout'))).toBeNull();
  });
});

describe('computers', () => {
  const lease = () => randomUUID();
  // The deployment's limit, set by each test.
  const limitOf = (cap: (organizationId: string) => number | null) => {
    computers = { ...computers, limits: { ...noLimits, computers: async (_, id) => cap(id) } };
  };
  const close = (member: Member, opened: { sessionId: string }, clientId = 'client') =>
    closeComputerSession(db, computers, caller(member, clientId), opened.sessionId);
  // A computer that is paused with no session, which may be replaced.
  const idle = async (member: Member, clientId = 'client') => {
    const opened = await open(member, clientId);
    await close(member, opened, clientId);
    return opened;
  };
  it('makes a new computer from the template for each open, with the latest capture, and runs them at once', async () => {
    const a = await user('a');
    await saveFromBrowser(db, a, bundle([cookie()]));
    const claude = await openComputerSession(db, computers, caller(a, 'claude'), { label: 'Order history' });
    if ('error' in claude) throw new Error(claude.error);
    await claude.done();
    const chatgpt = await open(a, 'chatgpt');
    expect(claude.computer).toEqual({
      account: 'deployment',
      id: expect.stringMatching(/^cmp_/),
      label: 'Order history',
      created: true,
      size: '1x',
    });
    expect(chatgpt.computer).toMatchObject({ label: null, created: true });
    expect(chatgpt.computer.id).not.toBe(claude.computer.id);
    // Each computer is made from the template, and the capture reaches it wholesale: it has no baseline.
    expect(fake.calls.create).toBe(2);
    for (const id of [claude.computer.id, chatgpt.computer.id]) {
      expect((await sandboxOf(id)).cookies.map(entry => entry.name)).toEqual(['sid']);
      expect(await rowOf(id)).toMatchObject({ status: 'ready', lastUsedAt: expect.any(Date) });
    }
    expect(claude.sync).toMatchObject({ status: 'applied', sitesUpdated: 1 });
    // Both sessions are live at once, each on its own computer.
    expect(await use(a, claude.sessionId, 'claude')).not.toHaveProperty('error');
    expect(await use(a, chatgpt.sessionId, 'chatgpt')).not.toHaveProperty('error');
    expect((await sessions()).filter(session => !session.endedAt)).toHaveLength(2);
  });
  it('reopens a computer by ID for any agent of the member, applying only captures newer than its last open', async () => {
    const a = await user('a');
    await saveFromBrowser(db, a, bundle([cookie()]));
    const first = await open(a, 'claude');
    const id = first.computer.id;
    await closeComputerSession(db, computers, caller(a, 'claude'), first.sessionId);
    expect(await sandboxOf(id)).toMatchObject({ paused: true });
    (await sandboxOf(id)).tabs = ['https://example.com/work'];
    await saveFromBrowser(db, a, bundle([cookie({ value: 'new' })], new Date('2026-10-20T11:00:00Z')));
    const reopened = await open(a, 'chatgpt', undefined, id);
    expect(reopened.computer).toEqual({ account: 'deployment', id, label: null, created: false, size: '1x' });
    expect(reopened.sync).toMatchObject({ status: 'applied', sitesUpdated: 1 });
    // The same computer, resumed with its work, and the newest sign-in.
    expect(fake.calls.create).toBe(1);
    expect(await sandboxOf(id)).toMatchObject({ paused: false, tabs: ['https://example.com/work'] });
    expect((await sandboxOf(id)).cookies.map(entry => entry.value)).toEqual(['new']);
    expect((await open(a, 'chatgpt', reopened.sessionId)).sync).toMatchObject({ status: 'unchanged' });
    expect(fake.calls.sync).toBe(2);
  });
  it("refuses another member's or organization's computer, and a malformed ID", async () => {
    const a = await user('a');
    const b = await user('b');
    const team = await join(a.userId, b.organizationId);
    const opened = await open(a, 'claude');
    for (const [member, computerId] of [
      [b, opened.computer.id],
      [team, opened.computer.id],
      [a, newPublicId('computer')],
      [a, 'not-a-computer'],
    ] as const) {
      expect(await openComputerSession(db, computers, caller(member, 'claude'), { computerId })).toMatchObject({
        error: 'computer_not_found',
      });
      expect(await deleteComputer(db, computers, caller(member, 'claude'), computerId)).toMatchObject({
        error: 'computer_not_found',
      });
      expect(await deleteComputer(db, computers, member, computerId)).toMatchObject({
        error: 'computer_not_found',
      });
      expect(await takeOverComputer(db, computers, member, lease(), { computerId })).toMatchObject({
        error: 'computer_not_found',
      });
    }
    expect(await sessionRow(opened.sessionId)).toMatchObject({ endedAt: null });
    expect(fake.calls.kill).toBe(0);
  });
  it('gives busy to a second open of a computer that a computer session controls, until its idle minute ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const first = await open(a, 'claude');
    const id = first.computer.id;
    at('2026-10-20T12:00:30Z');
    // Another agent, or another conversation of the same client without the session_id.
    for (const clientId of ['chatgpt', 'claude'])
      expect(await openComputerSession(db, computers, caller(a, clientId), { computerId: id })).toMatchObject({
        error: 'busy',
        busyUntil: new Date('2026-10-20T12:01:00Z'),
      });
    expect(await use(a, first.sessionId, 'claude')).not.toHaveProperty('error');
    at('2026-10-20T12:01:20Z');
    expect(await openComputerSession(db, computers, caller(a, 'chatgpt'), { computerId: id })).toMatchObject({
      error: 'busy',
      busyUntil: new Date('2026-10-20T12:01:30Z'),
    });
    expect(await listComputers(db, computers, a)).toEqual([
      expect.objectContaining({ computerId: id, status: 'in_use' }),
    ]);
    // Its idle minute over, it paused.
    at('2026-10-20T12:01:31Z');
    expect(await listComputers(db, computers, a)).toEqual([expect.objectContaining({ status: 'paused' })]);
    const second = await open(a, 'chatgpt', undefined, id);
    expect(await sessionRow(first.sessionId)).toMatchObject({ endReason: 'superseded' });
    expect(await use(a, first.sessionId, 'claude')).toMatchObject({ error: 'session_ended' });
    expect(await use(a, second.sessionId, 'chatgpt')).not.toHaveProperty('error');
  });
  it("replaces the caller's own session on its computer when computer_open is given its session_id", async () => {
    const a = await user('a');
    const first = await open(a, 'claude');
    const second = await open(a, 'claude', first.sessionId);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.computer).toMatchObject({ id: first.computer.id, created: false });
    expect(await sessionRow(first.sessionId)).toMatchObject({ endReason: 'replaced' });
    expect(await use(a, first.sessionId, 'claude')).toMatchObject({ error: 'session_ended' });
    // Another client cannot use a session_id it learned to take over: it gets a computer of its own.
    const other = await open(a, 'chatgpt', second.sessionId);
    expect(other.computer).toMatchObject({ created: true });
    expect(await sessionRow(second.sessionId)).toMatchObject({ endedAt: null });
  });
  it("joins an MCP client's retry of a new-computer open to the first open, once it ends, instead of making another", async () => {
    const a = await user('a');
    await saveFromBrowser(db, a, bundle([cookie()]));
    // The provider's create takes seconds, so the client's retry arrives while the first open runs.
    let release!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const create = fake.provider.create;
    vi.spyOn(fake.provider, 'create').mockImplementationOnce(async (...args) => {
      await held;
      return create(...args);
    });
    const options = { label: 'Order history', joinRetries: true };
    const first = openComputerSession(db, computers, caller(a, 'claude'), options);
    await vi.waitFor(async () => expect(await computerRows()).toHaveLength(1));
    let joinedYet = false;
    const second = openComputerSession(db, computers, caller(a, 'claude'), options).finally(() => {
      joinedYet = true;
    });
    release();
    const lost = await first;
    if ('error' in lost) throw new Error(lost.error);
    // The retry waits for the first open's call to end, so the two never apply to the computer at once.
    await new Promise(resolve => setTimeout(resolve, 1_000));
    expect(joinedYet).toBe(false);
    await lost.done();
    const joined = await second;
    if ('error' in joined) throw new Error(joined.error);
    await joined.done();
    expect(joined.computer).toMatchObject({ id: lost.computer.id, label: 'Order history', created: true });
    expect(fake.calls.create).toBe(1);
    expect(await sessionRow(lost.sessionId)).toMatchObject({ endReason: 'replaced' });
    expect(await use(a, joined.sessionId, 'claude')).not.toHaveProperty('error');
    expect((await sandboxOf(joined.computer.id)).cookies.map(entry => entry.name)).toEqual(['sid']);
  });
  it('opens a new computer for an open that only resembles a retry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const label = 'Order history';
    const openNew = async (clientId: string, options: { label?: string; joinRetries?: boolean }) => {
      const opened = await openComputerSession(db, computers, caller(a, clientId), options);
      if ('error' in opened) throw new Error(opened.error);
      await opened.done();
      expect(opened.computer.created).toBe(true);
      return opened;
    };
    const ids = [(await openNew('claude', { label, joinRetries: true })).computer.id];
    at('2026-10-20T12:00:02Z');
    // Another agent, another label, no label, or a caller that doesn't join retries (the REST API).
    for (const [clientId, options] of [
      ['chatgpt', { label, joinRetries: true }],
      ['claude', { label: 'Invoices', joinRetries: true }],
      ['claude', { joinRetries: true }],
      ['claude', { label }],
    ] as const)
      ids.push((await openNew(clientId, options)).computer.id);
    // Later than a retry comes.
    at('2026-10-20T12:00:13Z');
    const later = await openNew('claude', { label, joinRetries: true });
    ids.push(later.computer.id);
    // A first session the agent has already closed: it got that result.
    await closeComputerSession(db, computers, caller(a, 'claude'), later.sessionId);
    at('2026-10-20T12:00:14Z');
    ids.push((await openNew('claude', { label, joinRetries: true })).computer.id);
    expect(new Set(ids).size).toBe(7);
    expect(fake.calls.create).toBe(7);
  });
  it('creates freely under the cap, counting per member and never across an organization', async () => {
    const a = await user('a');
    const teammate = await join((await user('t')).userId, a.organizationId);
    limitOf(() => 2);
    await idle(a);
    await idle(a);
    expect(fake.calls.kill).toBe(0);
    // A teammate in the same organization has places of their own.
    await idle(teammate);
    await idle(teammate);
    expect(fake.calls.kill).toBe(0);
    expect(await computerRows()).toHaveLength(4);
  });
  it('replaces the least recently used idle computer at the cap, kills it, and its ID then answers computer_not_found', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    limitOf(() => 2);
    const older = await idle(a);
    at('2026-10-20T12:00:10Z');
    const newer = await idle(a);
    // Reopening the older one makes the newer one the least recently used.
    at('2026-10-20T12:00:20Z');
    const again = await open(a, 'client', undefined, older.computer.id);
    await close(a, again);
    const gone = (await rowOf(newer.computer.id)).sandboxId!;
    at('2026-10-20T12:00:30Z');
    const third = await open(a);
    expect(third.computer.created).toBe(true);
    expect(fake.calls.kill).toBe(1);
    expect(fake.sandboxes.has(gone)).toBe(false);
    expect((await listComputers(db, computers, a)).map(row => row.computerId)).toEqual([
      third.computer.id,
      older.computer.id,
    ]);
    // Its row and sessions went with it.
    expect(await openComputerSession(db, computers, caller(a), { computerId: newer.computer.id })).toMatchObject({
      error: 'computer_not_found',
    });
    expect(await use(a, newer.sessionId)).toMatchObject({ error: 'session_not_found' });
  });
  it('opens all the same when killing the replaced computer fails, and logs it', async () => {
    const a = await user('a');
    limitOf(() => 1);
    await idle(a);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(fake.provider, 'kill').mockRejectedValueOnce(new Error('kill failed'));
    expect(await open(a)).toHaveProperty('sessionId');
    expect(error).toHaveBeenCalled();
    expect(await computerRows()).toHaveLength(1);
  });
  it('gives busy with busy_until when no computer can be replaced, and replaces one once it can', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    limitOf(() => 2);
    const first = await open(a, 'claude');
    at('2026-10-20T12:00:10Z');
    const second = await open(a, 'claude');
    at('2026-10-20T12:00:20Z');
    // Each is running and under a session's control, so the earliest to pause says when to come back.
    expect(await openComputerSession(db, computers, caller(a, 'chatgpt'))).toMatchObject({
      error: 'busy',
      busyUntil: new Date('2026-10-20T12:01:00Z'),
      message: expect.stringContaining('computer_delete'),
    });
    expect(fake.calls.create).toBe(2);
    expect(fake.calls.kill).toBe(0);
    // Reopening never checks the cap.
    expect(await open(a, 'claude', first.sessionId)).toHaveProperty('sessionId');
    // A computer the user took over isn't replaced either, however idle.
    at('2026-10-20T12:02:00Z');
    await takeOverComputer(db, computers, a, lease(), { computerId: first.computer.id });
    at('2026-10-20T12:02:10Z');
    const third = await open(a, 'chatgpt');
    expect(fake.calls.kill).toBe(1);
    expect(await openComputerSession(db, computers, caller(a), { computerId: second.computer.id })).toMatchObject({
      error: 'computer_not_found',
    });
    expect(await rowOf(first.computer.id)).toMatchObject({ takeoverLease: expect.any(String) });
    expect(third.computer.created).toBe(true);
  });
  it('lets only one of two concurrent opens take the last place', async () => {
    const a = await user('a');
    limitOf(() => 1);
    const results = await Promise.all([
      openComputerSession(db, computers, caller(a)),
      openComputerSession(db, computers, caller(a, 'chatgpt')),
    ]);
    expect(results.filter(result => !('error' in result))).toHaveLength(1);
    expect(results.filter(result => 'error' in result)).toEqual([expect.objectContaining({ error: 'busy' })]);
    expect(await computerRows()).toHaveLength(1);
    expect(fake.calls.create).toBe(1);
  });
  it('trims idle computers past a lowered cap, keeping the most recently used and leaving running ones for later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    let cap = 4;
    limitOf(() => cap);
    const oldest = await open(a, 'claude');
    at('2026-10-20T12:00:10Z');
    const second = await idle(a);
    at('2026-10-20T12:00:20Z');
    const third = await idle(a);
    at('2026-10-20T12:00:30Z');
    const newest = await idle(a);
    // The oldest is first in line but still running, so it stays for a later pass, and its place stays taken.
    cap = 2;
    expect((await listComputers(db, computers, a)).map(row => row.computerId)).toEqual([
      newest.computer.id,
      third.computer.id,
      oldest.computer.id,
    ]);
    expect(fake.calls.kill).toBe(1);
    expect(await openComputerSession(db, computers, caller(a), { computerId: second.computer.id })).toMatchObject({
      error: 'computer_not_found',
    });
    // Over the cap with nothing replaceable, a new computer has to wait.
    expect(await openComputerSession(db, computers, caller(a, 'chatgpt'))).toMatchObject({ error: 'busy' });
    // Once it stops running, the next open trims it first; the cap then replaces the next in line.
    at('2026-10-20T12:02:00Z');
    const fresh = await open(a, 'chatgpt');
    expect((await listComputers(db, computers, a)).map(row => row.computerId)).toEqual([
      fresh.computer.id,
      newest.computer.id,
    ]);
    expect(await openComputerSession(db, computers, caller(a), { computerId: oldest.computer.id })).toMatchObject({
      error: 'computer_not_found',
    });
  });
  it('keeps the remaining computers when a trim fails to kill one, and logs it', async () => {
    const a = await user('a');
    let cap = 2;
    limitOf(() => cap);
    await idle(a);
    await idle(a);
    cap = 1;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(fake.provider, 'kill').mockRejectedValueOnce(new Error('kill failed'));
    expect(await listComputers(db, computers, a)).toHaveLength(1);
    expect(error).toHaveBeenCalled();
  });
  it('refuses to create at a cap of 0, with a clear busy and no busy_until, and trims what is left', async () => {
    const a = await user('a');
    let cap = 1;
    limitOf(() => cap);
    const before = await idle(a);
    cap = 0;
    const refused = await openComputerSession(db, computers, caller(a));
    expect(refused).toMatchObject({ error: 'busy', message: expect.stringContaining('no computers') });
    expect(refused).not.toHaveProperty('busyUntil');
    expect(fake.calls.create).toBe(1);
    expect(await sessions()).toEqual([]);
    expect(await listComputers(db, computers, a)).toEqual([]);
    expect(await computerView(db, computers, a)).toMatchObject({ computers: [], limit: 0, replaces: null });
    expect(await openComputerSession(db, computers, caller(a), { computerId: before.computer.id })).toMatchObject({
      error: 'computer_not_found',
    });
  });
  it("takes the deployment's limit, and the default where it sets none", async () => {
    const a = await user('a');
    const other = await user('c');
    limitOf(id => (id === a.organizationId ? 1 : null));
    await idle(a);
    await idle(a);
    expect(await computerRows()).toHaveLength(1);
    expect(fake.calls.kill).toBe(1);
    // An organization the limit leaves alone gets the product's default, and only past it replaces.
    for (let i = 0; i < DEFAULT_MAX_COMPUTERS; i++) await idle(other);
    expect(fake.calls.kill).toBe(1);
    await idle(other);
    expect(fake.calls.kill).toBe(2);
    expect(await computerView(db, computers, other)).toMatchObject({ limit: DEFAULT_MAX_COMPUTERS });
  });
  it('never deletes a computer for disuse', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-01T12:00:00Z');
    const a = await user('a');
    const b = await user('b');
    const old = await idle(a);
    at('2027-10-01T12:00:00Z');
    await idle(b);
    await sweepAbandoned(db, { provider: fake.provider });
    expect((await listComputers(db, computers, a)).map(row => row.computerId)).toEqual([old.computer.id]);
    expect(await open(a, 'client', undefined, old.computer.id)).toHaveProperty('sessionId');
  });
  it('deletes creates abandoned past their limit when a close or delete sweeps, and replaces one at the cap', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-01T12:00:00Z');
    const a = await user('a');
    const b = await user('b');
    const abandon = async (member: Member) => {
      const publicId = newPublicId('computer');
      await db.insert(schema.computers).values({
        publicId,
        membershipId: member.membershipId,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      });
      await fake.provider.create(publicId, 60_000, '1x');
      return publicId;
    };
    const fresh = await abandon(a);
    // Any member's close sweeps the deployment, once it is past CREATE_STALE_MS.
    expect((await listComputers(db, computers, a)).map(row => row.status)).toEqual(['starting']);
    at('2026-10-01T12:30:00Z');
    await idle(b);
    expect(await listComputers(db, computers, a)).toEqual([]);
    expect([...fake.sandboxes.values()].map(entry => entry.computerId)).not.toContain(fresh);
    // A member's only place, held by an abandoned create, is not stuck until a sweep.
    limitOf(() => 1);
    const stale = await abandon(a);
    at('2026-10-01T13:00:00Z');
    await open(a);
    expect(await rowOf(stale)).toBeUndefined();
  });
  it('deletes a computer whose create failed, with its session, so nothing is left behind', async () => {
    const a = await user('a');
    vi.spyOn(fake.provider, 'create').mockRejectedValueOnce(new Error('create failed'));
    await expect(openComputerSession(db, computers, caller(a))).rejects.toThrow('create failed');
    expect(await computerRows()).toEqual([]);
    expect(await sessions()).toEqual([]);
    expect(await open(a)).toHaveProperty('sessionId');
  });
  it("lists the member's computers with their status, and deletes one with what was on it", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const b = await user('b');
    const first = await openComputerSession(db, computers, caller(a, 'claude'), { label: 'Invoices' });
    if ('error' in first) throw new Error(first.error);
    await first.done();
    at('2026-10-20T12:00:10Z');
    const second = await open(a, 'chatgpt');
    await closeComputerSession(db, computers, caller(a, 'chatgpt'), second.sessionId);
    await open(b, 'claude');
    expect(await listComputers(db, computers, a)).toEqual([
      {
        computerId: second.computer.id,
        label: null,
        createdAt: '2026-10-20T12:00:10.000Z',
        lastUsedAt: '2026-10-20T12:00:10.000Z',
        status: 'paused',
        // Its session closed.
        agent: null,
      },
      {
        computerId: first.computer.id,
        label: 'Invoices',
        createdAt: '2026-10-20T12:00:00.000Z',
        lastUsedAt: '2026-10-20T12:00:00.000Z',
        status: 'in_use',
        agent: { agent: null, host: 'claude' },
      },
    ]);
    // Another agent's session holding it means busy, for an agent or the member; the agent's own just ends.
    expect(await deleteComputer(db, computers, caller(a, 'chatgpt'), first.computer.id)).toMatchObject({
      error: 'busy',
      busyUntil: new Date('2026-10-20T12:01:00Z'),
    });
    expect(await deleteComputer(db, computers, a, first.computer.id)).toMatchObject({ error: 'busy' });
    const sandboxId = (await rowOf(first.computer.id)).sandboxId!;
    expect(await deleteComputer(db, computers, caller(a, 'claude'), first.computer.id)).toEqual({ deleted: true });
    expect(fake.sandboxes.has(sandboxId)).toBe(false);
    expect(await useComputerSession(db, computers, caller(a, 'claude'), first.sessionId)).toMatchObject({
      error: 'session_not_found',
    });
    expect((await listComputers(db, computers, a)).map(row => row.computerId)).toEqual([second.computer.id]);
    expect(await openComputerSession(db, computers, caller(a), { computerId: first.computer.id })).toMatchObject({
      error: 'computer_not_found',
    });
    // A user's takeover of a computer means busy too.
    const page = lease();
    await takeOverComputer(db, computers, a, page, { computerId: second.computer.id });
    expect(await deleteComputer(db, computers, caller(a, 'claude'), second.computer.id)).toMatchObject({
      error: 'busy',
    });
    await handBackComputer(db, computers, a, page, { computerId: second.computer.id });
    await liveViewHeartbeat(db, computers, a, { id: page, state: 'released' }, new Date(), {
      computerId: second.computer.id,
    });
    // The member deletes an idle one from the page.
    expect(await deleteComputer(db, computers, a, second.computer.id)).toEqual({ deleted: true });
  });
  it('makes a paused computer with the latest capture and no agent, for the page', async () => {
    const a = await user('a');
    await saveFromBrowser(db, a, bundle([cookie()]));
    await setComputerScreen(db, a, '1920x1200');
    const made = await createPausedComputer(db, computers, a);
    if ('error' in made) throw new Error(made.error);
    expect(made.computerId).toMatch(/^cmp_/);
    expect(await sandboxOf(made.computerId)).toMatchObject({
      paused: true,
      screen: { width: 1920, height: 1200 },
    });
    expect((await sandboxOf(made.computerId)).cookies.map(entry => entry.name)).toEqual(['sid']);
    expect(await rowOf(made.computerId)).toMatchObject({ status: 'ready', label: null });
    expect(await sessions()).toEqual([]);
    expect(await db.select().from(schema.setups)).toEqual([]);
    expect(await listComputers(db, computers, a)).toEqual([
      expect.objectContaining({ computerId: made.computerId, status: 'paused', agent: null }),
    ]);
    // An agent can reopen it by ID, and the capture is already there.
    const opened = await open(a, 'claude', undefined, made.computerId);
    expect(opened.computer).toMatchObject({ id: made.computerId, created: false });
    expect(opened.sync).toMatchObject({ status: 'unchanged' });
  });
  it('replaces only the computer the page confirmed at the cap, and says which is next', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    limitOf(() => 2);
    const older = await idle(a);
    at('2026-10-20T12:00:10Z');
    const newer = await idle(a);
    expect(await computerView(db, computers, a)).toMatchObject({
      limit: 2,
      replaces: { computerId: older.computer.id },
    });
    // Without a confirmation of that computer, or with a stale one, nothing is deleted.
    expect(await createPausedComputer(db, computers, a)).toMatchObject({ error: 'confirm_replace' });
    expect(await createPausedComputer(db, computers, a, { replace: newer.computer.id })).toMatchObject({
      error: 'confirm_replace',
    });
    expect(fake.calls.kill).toBe(0);
    expect(fake.calls.create).toBe(2);
    const made = await createPausedComputer(db, computers, a, { replace: older.computer.id });
    if ('error' in made) throw new Error(made.error);
    expect(fake.calls.kill).toBe(1);
    expect(await rowOf(older.computer.id)).toBeUndefined();
    expect(await computerView(db, computers, a)).toMatchObject({ replaces: { computerId: newer.computer.id } });
    // Under the cap, the view names nothing, and no confirmation is needed.
    limitOf(() => 3);
    expect(await computerView(db, computers, a)).toMatchObject({ replaces: null });
    expect(await createPausedComputer(db, computers, a)).toHaveProperty('computerId');
  });
  it('makes no paused computer when none can be replaced, or metering refuses, or the plan allows none', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const page = randomUUID();
    let cap = 1;
    limitOf(() => cap);
    const running = await open(a);
    expect(await computerView(db, computers, a)).toMatchObject({ replaces: null });
    expect(await createPausedComputer(db, computers, a)).toMatchObject({
      error: 'busy',
      busyUntil: new Date('2026-10-20T12:01:00Z'),
    });
    await close(a, running);
    await takeOverComputer(db, computers, a, page, { computerId: running.computer.id });
    expect(await createPausedComputer(db, computers, a)).toMatchObject({ error: 'busy' });
    refusal = { message: 'Used up.', resetsAt: new Date('2026-11-01T00:00:00Z') };
    expect(await createPausedComputer(db, computers, a)).toMatchObject({ error: 'credit_exhausted' });
    refusal = null;
    cap = 0;
    expect(await createPausedComputer(db, computers, a)).toMatchObject({
      error: 'busy',
      message: expect.stringContaining('no computers'),
    });
    expect(fake.calls.create).toBe(1);
  });
});

describe('computer sessions', () => {
  it('issues an opaque session ID that works only for the user and client that opened it', async () => {
    const a = await user('a');
    const b = await user('b');
    const opened = await open(a, 'claude');
    expect(opened.sessionId).toMatch(SESSION_ID_PATTERN);
    expect(opened.sessionId).not.toContain(opened.computer.id.slice(4));
    expect(await use(a, opened.sessionId, 'claude')).not.toHaveProperty('error');
    for (const [userId, clientId, sessionId] of [
      [b, 'claude', opened.sessionId],
      [a, 'chatgpt', opened.sessionId],
      [a, 'claude', `cs_${randomBytes(32).toString('base64url')}`],
      [a, 'claude', newPublicId('computerSession')],
      [a, 'claude', 'not-a-session'],
      [a, 'claude', opened.computer.id],
    ] as const)
      for (const action of [useComputerSession, closeComputerSession])
        expect(await action(db, computers, caller(userId, clientId), sessionId)).toMatchObject({
          error: 'session_not_found',
        });
    // Nothing above ended or touched the session.
    expect(await sessionRow(opened.sessionId)).toMatchObject({ endedAt: null });
    expect((await computerRow()).callsInFlight).toEqual({});
  });
  it('ends the session of an open that failed to reach the computer, so a retry is not busy', async () => {
    const a = await user('a');
    vi.spyOn(fake.provider, 'connect').mockRejectedValueOnce(new Error('unreachable'));
    await expect(openComputerSession(db, computers, caller(a))).rejects.toThrow('unreachable');
    expect(await sessions()).toEqual([expect.objectContaining({ endReason: 'closed' })]);
    expect((await computerRow()).callsInFlight).toEqual({});
    expect(await open(a, 'client', undefined, (await computerRow()).publicId)).toHaveProperty('sessionId');
  });
  it('holds control for a call in flight past the idle minute, until the call ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const first = await open(a, 'claude');
    const call = await useComputerSession(db, computers, caller(a, 'claude'), first.sessionId);
    if ('error' in call) throw new Error(call.error);
    at('2026-10-20T12:01:30Z');
    expect(
      await openComputerSession(db, computers, caller(a, 'chatgpt'), { computerId: first.computer.id }),
    ).toMatchObject({
      error: 'busy',
      busyUntil: new Date('2026-10-20T12:02:40Z'),
    });
    await call.done();
    await call.done();
    expect(await sessionRow(first.sessionId)).toMatchObject({ lastCallAt: new Date('2026-10-20T12:01:30Z') });
    expect((await computerRow()).callsInFlight).toEqual({});
    at('2026-10-20T12:02:31Z');
    expect(await open(a, 'chatgpt', undefined, first.computer.id)).toHaveProperty('sessionId');
  });
  it('ends a session after 10 idle minutes, and a session idle less resumes without busy', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const opened = await open(a);
    at('2026-10-20T12:09:59Z');
    expect(await use(a, opened.sessionId)).not.toHaveProperty('error');
    at('2026-10-20T12:20:00Z');
    expect(await use(a, opened.sessionId)).toMatchObject({ error: 'session_ended' });
    expect(await sessionRow(opened.sessionId)).toMatchObject({ endReason: 'idle' });
    expect(await closeComputerSession(db, computers, caller(a), opened.sessionId)).toMatchObject({
      error: 'session_ended',
    });
    // Its computer stays, for a reopen.
    expect((await open(a, 'client', opened.sessionId)).computer).toMatchObject({ id: opened.computer.id });
  });
  it('starts and uses no session when the guard finds the access revoked', async () => {
    const a = await user('a');
    const revokedCaller = caller(a, 'claude', async () => false);
    expect(await openComputerSession(db, computers, revokedCaller)).toMatchObject({ error: 'access_revoked' });
    expect(await sessions()).toHaveLength(0);
    expect(await computerRows()).toHaveLength(0);
    const opened = await open(a, 'claude');
    expect(await openComputerSession(db, computers, revokedCaller, { computerId: opened.computer.id })).toMatchObject({
      error: 'access_revoked',
    });
    expect(await deleteComputer(db, computers, revokedCaller, opened.computer.id)).toMatchObject({
      error: 'access_revoked',
    });
    for (const action of [useComputerSession, closeComputerSession])
      expect(await action(db, computers, revokedCaller, opened.sessionId)).toMatchObject({ error: 'access_revoked' });
    expect(await sessionRow(opened.sessionId)).toMatchObject({ endedAt: null });
    expect((await computerRow()).callsInFlight).toEqual({});
  });
  it("revoking an agent ends its sessions, and only that agent's", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const clientId = 'https://client.example.test/agent.json';
    await db.insert(schema.oauthClient).values({ id: randomUUID(), clientId, redirectUris: [] });
    await grant(a, clientId);
    const other = await open(a, 'other');
    expect(await revokeMcpGrant(db, a, clientId)).toBe(true);
    expect(await sessionRow(other.sessionId)).toMatchObject({ endedAt: null });
    at('2026-10-20T12:01:01Z');
    const agent = await open(a, clientId);
    await grant(a, clientId);
    expect(await revokeMcpGrant(db, a, clientId)).toBe(true);
    expect(await sessionRow(agent.sessionId)).toMatchObject({ endReason: 'revoked' });
    // Only the guard reports the revocation; once the agent is reconnected, its old session is just ended.
    expect(
      await useComputerSession(
        db,
        computers,
        caller(a, clientId, async () => false),
        agent.sessionId,
      ),
    ).toMatchObject({ error: 'access_revoked' });
    for (const action of [useComputerSession, closeComputerSession])
      expect(
        await action(
          db,
          computers,
          caller(a, clientId, async () => true),
          agent.sessionId,
        ),
      ).toMatchObject({
        error: 'session_ended',
      });
    // A revoked session no longer holds control of its computer, and revoking every agent ends the rest.
    expect(await open(a, 'next', undefined, agent.computer.id)).toHaveProperty('sessionId');
    await revokeMcpGrants(db, a);
    expect((await sessions()).filter(session => !session.endedAt)).toEqual([]);
  });
});

describe('per-call hold and metering', () => {
  it('holds each call for its budget plus the idle minute, and meters the running time after the fact', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const opened = await openComputerSession(db, computers, caller(a));
    if ('error' in opened) throw new Error(opened.error);
    // The create and the open's connect hold it for 160s. Nothing is charged ahead.
    expect(fake.calls.timeouts).toEqual([160_000, 160_000]);
    expect(fake.calls.pause).toBe(0);
    expect(await used(a)).toEqual([]);
    await opened.done();
    expect(fake.calls.setTimeouts).toEqual([60_000]);
    expect((await computerRow()).runsUntil).toEqual(new Date('2026-10-20T12:01:00Z'));
    at('2026-10-20T12:00:30Z');
    await use(a, opened.sessionId);
    expect(await used(a)).toEqual([['2026-10-20', 30]]);
    expect(await pausesBooked(a)).toBe(0);
    // After the computer paused, the next call books the idle minute it ran (to 12:01:30), not the time paused, and
    // the pause itself once, since the provider may bill its snapshot.
    at('2026-10-20T12:05:00Z');
    expect(await use(a, opened.sessionId)).not.toHaveProperty('error');
    expect(await used(a)).toEqual([['2026-10-20', 90]]);
    expect(await pausesBooked(a)).toBe(1);
    at('2026-10-20T12:05:30Z');
    await use(a, opened.sessionId);
    expect(await pausesBooked(a)).toBe(1);
  });
  it('lets only the last of overlapping calls shorten the timeout to the idle minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const opened = await open(a);
    const long = await useComputerSession(db, computers, caller(a), opened.sessionId);
    const short = await useComputerSession(db, computers, caller(a), opened.sessionId);
    if ('error' in long || 'error' in short) throw new Error('call failed');
    at('2026-10-20T12:00:05Z');
    await short.done();
    // The long call's deadline (12:01:40) plus the idle minute.
    expect(fake.calls.setTimeouts).toEqual([60_000, 155_000]);
    expect(await sessionRow(opened.sessionId)).toMatchObject({ lastCallAt: new Date('2026-10-20T12:01:40Z') });
    at('2026-10-20T12:01:20Z');
    await long.done();
    expect(fake.calls.setTimeouts).toEqual([60_000, 155_000, 60_000]);
    expect((await computerRow()).runsUntil).toEqual(new Date('2026-10-20T12:02:20Z'));
    // Running from 12:00:00 to the last call's end; the idle minute is booked at the next use.
    expect(await used(a)).toEqual([['2026-10-20', 80]]);
  });
  it('stops counting a call whose end was lost at its deadline, so later calls pause the computer again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const opened = await open(a, 'claude');
    // A call whose done() never runs (its function was killed).
    const lost = await useComputerSession(db, computers, caller(a, 'claude'), opened.sessionId);
    if ('error' in lost) throw new Error(lost.error);
    // Within its deadline (12:01:40) it still counts.
    at('2026-10-20T12:00:30Z');
    await use(a, opened.sessionId, 'claude');
    expect(fake.calls.setTimeouts.at(-1)).toBe(130_000);
    at('2026-10-20T12:05:00Z');
    await use(a, opened.sessionId, 'claude');
    expect(fake.calls.setTimeouts.at(-1)).toBe(60_000);
    expect((await computerRow()).runsUntil).toEqual(new Date('2026-10-20T12:06:00Z'));
    expect((await computerRow()).callsInFlight).toEqual({});
    expect(await sessionRow(opened.sessionId)).toMatchObject({ lastCallAt: new Date('2026-10-20T12:05:00Z') });
    at('2026-10-20T12:06:01Z');
    expect(await open(a, 'chatgpt', undefined, opened.computer.id)).toHaveProperty('sessionId');
  });
  it('books a call that outlives its budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const opened = await open(a);
    at('2026-10-20T12:05:00Z');
    const call = await useComputerSession(db, computers, caller(a), opened.sessionId);
    if ('error' in call) throw new Error(call.error);
    at('2026-10-20T12:06:50Z');
    await call.done();
    expect((await computerRow()).runsUntil).toEqual(new Date('2026-10-20T12:07:50Z'));
    // The open's idle minute, then the call's 110s, past its 100s budget.
    expect(await used(a)).toEqual([['2026-10-20', 170]]);
  });
  it('books running time to the UTC day it is metered on', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-31T23:59:30Z');
    const a = await user('a');
    const opened = await openComputerSession(db, computers, caller(a));
    if ('error' in opened) throw new Error(opened.error);
    at('2026-11-01T00:00:10Z');
    await opened.done();
    expect(await used(a)).toEqual([['2026-11-01', 40]]);
  });
  it("shows the billing period's running minutes and MCP calls under the default hooks, for the member only", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const b = await user('b');
    const defaults = { provider: fake.provider, metering: noMetering };
    const opened = await openComputerSession(db, defaults, caller(a));
    if ('error' in opened) throw new Error(opened.error);
    at('2026-10-20T12:01:30Z');
    await opened.done();
    const call = (member: Member, startedAt: string) => ({
      membershipId: member.membershipId,
      clientId: 'client',
      tool: 'browser',
      startedAt: new Date(startedAt),
      endedAt: new Date(startedAt),
    });
    await db
      .insert(schema.toolCalls)
      .values([
        call(a, '2026-09-30T23:59:59Z'),
        call(a, '2026-10-01T00:00:00Z'),
        call(a, '2026-10-20T12:00:00Z'),
        call(b, '2026-10-20T12:00:00Z'),
      ]);
    // Without a deployment's metering, the billing period is the UTC month. 90 seconds run rounds up to 2 minutes;
    // September's call isn't in it.
    const october = { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' };
    expect((await computerView(db, { provider: fake.provider, metering: noMetering }, a)).period).toEqual({
      ...october,
      minutes: 2,
      mcpCalls: 2,
    });
    expect((await computerView(db, { provider: fake.provider, metering: noMetering }, b)).period).toEqual({
      ...october,
      minutes: 0,
      mcpCalls: 1,
    });
    at('2026-11-01T00:00:00Z');
    expect((await computerView(db, { provider: fake.provider, metering: noMetering }, a)).period).toMatchObject({
      minutes: 0,
      mcpCalls: 0,
    });
  });
  it('keeps the longer pause when the provider does not take the shorter timeout', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.failSetTimeout();
    const opened = await open(a);
    expect((await computerRow()).runsUntil).toEqual(new Date('2026-10-20T12:02:40Z'));
    expect(await sessionRow(opened.sessionId)).toMatchObject({ lastCallAt: new Date('2026-10-20T12:00:00Z') });
    // So the next use books the whole hold as running.
    at('2026-10-20T12:05:00Z');
    await use(a, opened.sessionId);
    expect(await used(a)).toEqual([['2026-10-20', 160]]);
  });
});

describe('computer_close', () => {
  it('pauses the computer with its work kept, ends the session, and books the time it ran', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const opened = await open(a, 'claude');
    sandbox().tabs = ['https://a.example.com/', 'https://b.example.com/'];
    await saveFromBrowser(db, a, bundle([cookie()]));
    at('2026-10-20T12:00:20Z');
    expect(await closeComputerSession(db, computers, caller(a, 'chatgpt'), opened.sessionId)).toMatchObject({
      error: 'session_not_found',
    });
    expect(await closeComputerSession(db, computers, caller(a, 'claude'), opened.sessionId)).toEqual({ closed: true });
    // Nothing is applied or closed: the next open applies, and the agent comes back to its tabs.
    expect(sandbox()).toMatchObject({ paused: true, tabs: ['https://a.example.com/', 'https://b.example.com/'] });
    expect(fake.calls.sync).toBe(0);
    expect(await used(a)).toEqual([['2026-10-20', 20]]);
    expect((await computerRow()).runsUntil).toEqual(new Date('2026-10-20T12:00:20Z'));
    expect(await sessionRow(opened.sessionId)).toMatchObject({ endReason: 'closed' });
    for (const action of [useComputerSession, closeComputerSession])
      expect(await action(db, computers, caller(a, 'claude'), opened.sessionId)).toMatchObject({
        error: 'session_ended',
      });
    // The next open of the computer resumes it.
    await open(a, 'chatgpt', undefined, opened.computer.id);
    expect(sandbox()).toMatchObject({ paused: false });
    expect(fake.calls.sync).toBe(1);
  });
  it('leaves a call already in flight running, then lets it pause the computer and bills it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const opened = await open(a);
    at('2026-10-20T12:00:10Z');
    const call = await useComputerSession(db, computers, caller(a), opened.sessionId);
    if ('error' in call) throw new Error(call.error);
    at('2026-10-20T12:00:20Z');
    expect(await closeComputerSession(db, computers, caller(a), opened.sessionId)).toEqual({ closed: true });
    // The call's deadline (12:01:50) plus the idle minute, instead of a pause under the call.
    expect({ pause: fake.calls.pause, timeout: fake.calls.providerTimeouts.at(-1) }).toEqual({
      pause: 0,
      timeout: 150_000,
    });
    at('2026-10-20T12:00:40Z');
    await call.done();
    expect(fake.calls.setTimeouts.at(-1)).toBe(60_000);
    expect((await computerRow()).runsUntil).toEqual(new Date('2026-10-20T12:01:40Z'));
    // Running from 12:00:00 to the call's end.
    expect(await used(a)).toEqual([['2026-10-20', 40]]);
  });
  it('does not wake a computer that already paused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const opened = await open(a);
    at('2026-10-20T12:02:00Z');
    const before = { ...fake.calls, timeouts: fake.calls.timeouts.length };
    expect(await closeComputerSession(db, computers, caller(a), opened.sessionId)).toEqual({ closed: true });
    expect({ ...fake.calls, timeouts: fake.calls.timeouts.length }).toEqual(before);
    // The idle minute the computer ran is booked when it is next woken.
    expect(await used(a)).toEqual([]);
    expect(await sessionRow(opened.sessionId)).toMatchObject({ endReason: 'closed' });
  });
});

describe('apply on open', () => {
  // Each open passes the previous session_id, as one agent reopening its computer to apply.
  let last: string | undefined;
  const reopen = async (member: Member) => {
    const opened = await open(member, 'client', last);
    last = opened.sessionId;
    return opened;
  };
  beforeEach(() => {
    last = undefined;
  });
  const jar = () =>
    sandbox()
      .cookies.map(entry => `${entry.domain ?? new URL(entry.url!).hostname}:${entry.name}=${entry.value}`)
      .sort();
  const computerCookie = (name: string, value: string, host = 'example.com') => ({
    name,
    value,
    url: `https://${host}/`,
    path: '/',
    secure: true,
    httpOnly: true,
  });
  it('keeps a site rule’s cookies off the computer, and never touches the computer’s own', async () => {
    computers = { ...computers, siteRules: [{ site: 'example.com', keepOut: ['sid'] }] };
    const a = await user('a');
    await reopen(a);
    await saveFromBrowser(db, a, bundle([cookie(), cookie({ name: 'remember' })], new Date('2026-10-15T10:00:00Z')));
    await reopen(a);
    expect(jar()).toEqual(['example.com:remember=local']);
    // The site signs the computer in itself, then the browser's own session rotates and syncs.
    sandbox().cookies.push(computerCookie('sid', 'computer'));
    await saveFromBrowser(
      db,
      a,
      bundle(
        [cookie({ value: 'rotated' }), cookie({ name: 'remember', value: 'rotated' })],
        new Date('2026-10-15T11:00:00Z'),
      ),
    );
    await reopen(a);
    expect(jar()).toEqual(['example.com:remember=rotated', 'example.com:sid=computer']);
  });
  it('applies a new capture once, keeps agent-only sites, and clears sites signed out locally', async () => {
    const a = await user('a');
    expect((await reopen(a)).sync).toEqual({ status: 'none' });
    // Computer-origin state: a site only agents used, and a stale cookie for a site the capture holds.
    sandbox().cookies.push(
      { name: 'sid', value: 'computer', domain: '.google.com', path: '/', secure: true, httpOnly: true },
      computerCookie('tmp', 'agent', 'agent.dev'),
    );
    await saveFromBrowser(
      db,
      a,
      bundle(
        [
          cookie(),
          cookie({ name: 'gh', domain: '.github.com', hostOnly: false }),
          cookie({ domain: 'mail.google.com' }),
        ],
        new Date('2026-10-15T10:00:00Z'),
      ),
    );
    // No baseline yet: each target site is replaced wholesale.
    expect((await reopen(a)).sync).toEqual({
      status: 'applied',
      captureCompletedAt: '2026-10-15T10:00:00.000Z',
      sitesUpdated: 3,
    });
    expect(jar()).toEqual([
      '.github.com:gh=local',
      'agent.dev:tmp=agent',
      'example.com:sid=local',
      'mail.google.com:sid=local',
    ]);
    expect(await applied()).toMatchObject({ appliedCaptureAt: new Date('2026-10-15T10:00:00Z') });
    expect((await applied()).syncedSites).toEqual(['example.com', 'github.com', 'google.com']);
    expect((await applied()).appliedCapture).not.toMatch(/local|example/);
    // Unchanged capture: no provider work.
    expect((await reopen(a)).sync).toEqual({ status: 'unchanged', captureCompletedAt: '2026-10-15T10:00:00.000Z' });
    expect(fake.calls.sync).toBe(1);
    // Signed out of GitHub and Gmail locally, example.com refreshed.
    await saveFromBrowser(db, a, bundle([cookie({ value: 'fresh' })], new Date('2026-10-15T11:00:00Z')));
    expect((await reopen(a)).sync).toMatchObject({ status: 'applied', sitesUpdated: 3 });
    expect(jar()).toEqual(['agent.dev:tmp=agent', 'example.com:sid=fresh']);
    expect((await applied()).syncedSites).toEqual(['example.com']);
  });
  it('sets only what the host changed: the host wins its changes, the computer keeps the rest', async () => {
    const a = await user('a');
    await saveFromBrowser(
      db,
      a,
      bundle([
        cookie({ name: 'changed', value: '1' }),
        cookie({ name: 'kept', value: '1' }),
        cookie({ name: 'deleted', value: '1' }),
        cookie({ name: 'gh', domain: 'github.com' }),
      ]),
    );
    await reopen(a);
    // The computer rotates two cookies and sets one of its own on the synced site.
    const own = ['changed', 'kept', 'own'];
    sandbox().cookies = [
      ...sandbox().cookies.filter(entry => !own.includes(entry.name)),
      ...own.map(name => computerCookie(name, 'computer')),
    ];
    await saveFromBrowser(
      db,
      a,
      bundle([
        cookie({ name: 'changed', value: '2' }),
        cookie({ name: 'kept', value: '1' }),
        cookie({ name: 'added', value: '1' }),
      ]),
    );
    expect((await reopen(a)).sync).toMatchObject({ status: 'applied', sitesUpdated: 2 });
    expect(jar()).toEqual([
      'example.com:added=1',
      'example.com:changed=2',
      'example.com:kept=computer',
      'example.com:own=computer',
    ]);
    // A legacy row (or one after Delete everything) has no baseline: the next apply is wholesale again.
    await db.update(schema.computerProfiles).set({ appliedCapture: null });
    await saveFromBrowser(db, a, bundle([cookie({ name: 'kept', value: '1' })]));
    expect((await reopen(a)).sync).toMatchObject({ status: 'applied', sitesUpdated: 1 });
    expect(jar()).toEqual(['example.com:kept=1']);
  });
  it('never applies within a computer session; the next open of the computer does', async () => {
    const a = await user('a');
    await saveFromBrowser(db, a, bundle([cookie()]));
    await reopen(a);
    await saveFromBrowser(db, a, bundle([cookie({ value: 'rotated' }), cookie({ name: 'new', domain: 'notion.so' })]));
    expect(await use(a, last!)).not.toHaveProperty('pending');
    expect(fake.calls.sync).toBe(1);
    expect(jar()).toEqual(['example.com:sid=local']);
    expect((await reopen(a)).sync).toMatchObject({ status: 'applied', sitesUpdated: 2 });
    expect(jar()).toEqual(['example.com:sid=rotated', 'notion.so:new=local']);
  });
  it('still opens when apply fails and retries on the next open', async () => {
    const a = await user('a');
    await saveFromBrowser(db, a, bundle([cookie()], new Date('2026-10-15T10:00:00Z')));
    fake.failSync();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await reopen(a);
    expect(failed.sync).toEqual({ status: 'failed', captureCompletedAt: '2026-10-15T10:00:00.000Z' });
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/local|example\.com/);
    expect(await applied()).toMatchObject({ appliedCaptureDigest: null, appliedCaptureAt: null });
    fake.failSync(false);
    expect((await reopen(a)).sync).toMatchObject({ status: 'applied', sitesUpdated: 1 });
    expect(jar()).toEqual(['example.com:sid=local']);
  });
  it("sets the computer to the user's time zone on open, only when it changed, and retries a failure", async () => {
    const a = await user('a');
    await reopen(a);
    expect(fake.calls.timeZones).toEqual([]);
    await setTimeZone(db, a.userId, 'America/Los_Angeles');
    fake.failTimeZone();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await reopen(a)).sync).toEqual({ status: 'none' });
    expect(error).toHaveBeenCalled();
    expect((await computerRow()).timeZone).toBeNull();
    fake.failTimeZone(false);
    await reopen(a);
    expect(sandbox().timeZone).toBe('America/Los_Angeles');
    expect((await computerRow()).timeZone).toBe('America/Los_Angeles');
    await reopen(a);
    expect(fake.calls.timeZones).toEqual(['America/Los_Angeles', 'America/Los_Angeles']);
    await setTimeZone(db, a.userId, 'Europe/London');
    await reopen(a);
    expect(sandbox().timeZone).toBe('Europe/London');
  });
  it("follows the session's browser's time zone and languages over the web app's, before its cookies, once each", async () => {
    const a = await user('a');
    await setTimeZone(db, a.userId, 'America/Los_Angeles');
    const browser = await syncingBrowser(db, a);
    await saveFromBrowser(db, a, bundle([cookie()]));
    // Invalid parts are left out, and a part that didn't come keeps the last one.
    await recordBrowserEnvironment(db, browser.id, { timeZone: 'Not/AZone', languages: ['de-DE', 'de'] });
    await recordBrowserEnvironment(db, browser.id, { timeZone: 'Europe/Berlin' });
    await reopen(a);
    expect(sandbox().timeZone).toBe('Europe/Berlin');
    expect(sandbox().languages).toEqual({ [FIRST_PROFILE]: ['de-DE', 'de'] });
    // The zone's Chrome restart comes before the cookies it would drop, and the languages after the profile switch.
    expect(fake.calls.steps).toEqual(['refresh', 'zone', 'profile', 'languages', 'sync']);
    const [profile] = await db
      .select()
      .from(schema.computerProfiles)
      .where(isNotNull(schema.computerProfiles.computerId));
    expect(profile!.languages).toEqual(['de-DE', 'de']);
    await reopen(a);
    expect(fake.calls.timeZones).toEqual(['Europe/Berlin']);
    expect(fake.calls.languages).toHaveLength(1);
    // A browser that never reported a zone leaves the web app's.
    await db
      .update(schema.connectedBrowsers)
      .set({ timeZone: null })
      .where(eq(schema.connectedBrowsers.id, browser.id));
    await reopen(a);
    expect(sandbox().timeZone).toBe('America/Los_Angeles');
  });
  it("presents the session's browser's platform after its languages, set again only when it changes", async () => {
    const a = await user('a');
    const browser = await syncingBrowser(db, a);
    await saveFromBrowser(db, a, bundle([cookie()]));
    const mac = { platform: 'macOS', platformVersion: '26.6.2', architecture: 'arm', bitness: '64', model: '' };
    await recordBrowserEnvironment(db, browser.id, {
      languages: ['de-DE'],
      userAgentData: { ...mac, mobile: false, wow64: false, brands: [{ brand: 'Chromium', version: '156' }] },
    });
    await reopen(a);
    const presented = {
      platform: 'macOS',
      platformVersion: '26.6.2',
      architecture: 'arm',
      bitness: '64',
      wow64: false,
    };
    expect(sandbox().platforms).toEqual({ [FIRST_PROFILE]: presented });
    expect(fake.calls.steps).toEqual(['refresh', 'profile', 'languages', 'platform', 'sync']);
    const [profile] = await db
      .select()
      .from(schema.computerProfiles)
      .where(isNotNull(schema.computerProfiles.computerId));
    expect(profile!.platform).toEqual(presented);
    await reopen(a);
    expect(fake.calls.platforms).toHaveLength(1);
    // A browser now on Linux makes the computer present its own again.
    await recordBrowserEnvironment(db, browser.id, { userAgentData: { platform: 'Linux', mobile: false } });
    await reopen(a);
    expect(fake.calls.platforms.at(-1)).toEqual({ profile: FIRST_PROFILE, platform: null });
    expect(sandbox().platforms).toEqual({});
  });
  it('presents only a desktop macOS or Windows platform, from its client hints, never its user agent string', () => {
    expect(platformOverrideOf(undefined)).toBeNull();
    expect(platformOverrideOf({ platform: 'Linux', mobile: false })).toBeNull();
    expect(platformOverrideOf({ platform: 'Android', mobile: true })).toBeNull();
    expect(platformOverrideOf({ platform: 'macOS', mobile: true })).toBeNull();
    // Hints Chrome wouldn't report are left empty.
    expect(
      platformOverrideOf({
        platform: 'Windows',
        platformVersion: '15.0.0',
        architecture: 'x86',
        bitness: '64',
        mobile: false,
      }),
    ).toEqual({ platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', bitness: '64', wow64: false });
    expect(
      platformOverrideOf({
        platform: 'macOS',
        platformVersion: 'ten',
        architecture: 'mips',
        bitness: '128',
        mobile: false,
      }),
    ).toEqual({ platform: 'macOS', platformVersion: '', architecture: '', bitness: '', wow64: false });
  });
  it('brings a computer behind the provider revision current on open, before the apply, and retries a failure', async () => {
    const a = await user('a');
    await saveFromBrowser(db, a, bundle([cookie()]));
    await reopen(a);
    // A new computer on the current template is only checked, once.
    expect((await computerRow()).revision).toBe('revision-1');
    await reopen(a);
    // The open runs Chrome on the session's profile after the refresh, which may restart it, and before the apply.
    expect(fake.calls.steps).toEqual(['refresh', 'profile', 'sync', 'profile']);
    fake.setRevision('revision-2');
    fake.failRefresh();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await saveFromBrowser(db, a, bundle([cookie({ value: 'new' })]));
    expect((await reopen(a)).sync).toMatchObject({ status: 'applied' });
    expect(error).toHaveBeenCalled();
    expect((await computerRow()).revision).toBe('revision-1');
    fake.failRefresh(false);
    sandbox().tabs.push('https://example.com/');
    await reopen(a);
    expect(sandbox()).toMatchObject({ revision: 'revision-2', tabs: ['about:blank'] });
    expect(jar()).toEqual(['example.com:sid=new']);
    expect((await computerRow()).revision).toBe('revision-2');
    // Closing never refreshes; only opens do, before control is handed over.
    await closeComputerSession(db, computers, caller(a), last!);
    expect(fake.calls.steps).toEqual([
      'refresh',
      'profile',
      'sync',
      'profile',
      'refresh',
      'profile',
      'sync',
      'refresh',
      'profile',
    ]);
  });
  it('signs the computer out of its synced sites once captures are deleted, retrying a failure, and keeps the rest', async () => {
    const a = await user('a');
    const capture = bundle([cookie(), cookie({ name: 'new', domain: 'notion.so' })]);
    await saveFromBrowser(db, a, capture);
    await reopen(a);
    // A site the computer signed in to on its own.
    sandbox().cookies.push(computerCookie('sid', 'own', 'own.test'));
    await deleteCaptures(db, a);
    expect(await applied()).toMatchObject({ appliedCaptureDigest: null, appliedCapture: null });
    fake.failSync();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await reopen(a)).sync).toEqual({ status: 'failed', sites: ['example.com', 'notion.so'] });
    expect(error).toHaveBeenCalled();
    expect((await applied()).syncedSites).toEqual(['example.com', 'notion.so']);
    fake.failSync(false);
    expect((await reopen(a)).sync).toEqual({ status: 'cleared', sites: ['example.com', 'notion.so'] });
    expect(jar()).toEqual(['own.test:sid=own']);
    expect((await applied()).syncedSites).toEqual([]);
    // Nothing more to sign out.
    expect((await reopen(a)).sync).toEqual({ status: 'none' });
    await saveFromBrowser(db, a, capture);
    expect((await reopen(a)).sync).toMatchObject({ status: 'applied', sitesUpdated: 2 });
  });
  it('does not overwrite a concurrent apply of another capture, and re-applies wholesale next time', async () => {
    const a = await user('a');
    const first = await reopen(a);
    await saveFromBrowser(db, a, bundle([cookie()]));
    // Another open racing this one applies a different capture while this one runs.
    const connect = fake.provider.connect;
    fake.provider.connect = async (sandboxId, timeoutMs) => {
      const session = await connect(sandboxId, timeoutMs);
      return {
        ...session,
        syncCookies: async input => {
          await db
            .update(schema.computerProfiles)
            .set({ appliedCaptureDigest: 'other', syncedSites: ['other.test'] })
            .where(eq(schema.computerProfiles.computerId, (await rowOf(first.computer.id)).id));
          return session.syncCookies(input);
        },
      };
    };
    expect((await reopen(a)).sync).toMatchObject({ status: 'applied' });
    expect(await applied()).toMatchObject({ appliedCaptureDigest: null, appliedCapture: null });
    expect((await applied()).syncedSites.sort()).toEqual(['example.com', 'other.test']);
    fake.provider.connect = connect;
    expect((await reopen(a)).sync).toMatchObject({ status: 'applied', sitesUpdated: 2 });
    expect((await applied()).syncedSites).toEqual(['example.com']);
  });
  it('skips the apply when the open has no time left, without failing the open', async () => {
    const a = await user('a');
    await reopen(a);
    await saveFromBrowser(db, a, bundle([cookie()]));
    const now = Date.now.bind(Date);
    let skew = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now() + skew);
    const connect = fake.provider.connect;
    fake.provider.connect = async (sandboxId, timeoutMs) => {
      skew = 70_000;
      return connect(sandboxId, timeoutMs);
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await reopen(a)).sync).toMatchObject({ status: 'failed' });
      expect(fake.calls.sync).toBe(0);
    } finally {
      vi.restoreAllMocks();
      fake.provider.connect = connect;
    }
  });
  it('gives the provider its budget, so a sync cut short never changes cookies after the open returns', async () => {
    const a = await user('a');
    await reopen(a);
    await saveFromBrowser(db, a, bundle([cookie()]));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fake.slowSync(50_000);
      let returned = false;
      const opening = reopen(a).finally(() => {
        returned = true;
      });
      await vi.waitFor(() => expect(fake.calls.sync).toBe(1));
      while (!returned) await vi.advanceTimersByTimeAsync(1_000);
      expect((await opening).sync).toMatchObject({ status: 'failed' });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(jar()).toEqual([]);
      expect(await computerRow()).toMatchObject({ appliedCaptureDigest: null, appliedCapture: null });
      expect(fake.calls.syncBudgets[0]).toBeLessThanOrEqual(45_000);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});

describe('profiles', () => {
  // A browser of the member's signed in to example.com as someone, by its cookie's value.
  const signIn = async (member: Member, name: string, value = name) => {
    const browser = await syncingBrowser(db, member, {
      name,
      ...(name === 'personal' ? { userAgent: EDGE_ON_WINDOWS } : {}),
    });
    expect(await saveFromBrowser(db, member, bundle([cookie({ value })]), { browser: browser.id })).toMatchObject({
      status: 'stored',
    });
    return browser;
  };
  // An open whose call has ended, as the MCP layer leaves it.
  const openWith = async (member: Member, options: Parameters<typeof openComputerSession>[3] = {}) => {
    const opened = await openComputerSession(db, computers, caller(member), options);
    if ('error' in opened) throw new Error(opened.error);
    await opened.done();
    return opened;
  };
  const values = (cookies: { value: string }[] = []) => cookies.map(entry => entry.value).sort();
  const sessionProfiles = async () =>
    (await db.select().from(schema.computerSessions).orderBy(schema.computerSessions.id)).map(
      row => row.connectedBrowserId,
    );
  it('gives each browser its own Chrome profile, so one site is signed in as each person', async () => {
    const a = await user('a');
    const work = await signIn(a, 'work');
    const personal = await signIn(a, 'personal');
    // Without a profile, a new computer gets the browser synced last, in the directory its Chrome already runs.
    const first = await openWith(a);
    expect(first.profile).toMatchObject({ id: personal.publicId, browser: 'edge', platform: 'windows', default: true });
    expect(first.profiles.map(profile => profile.id)).toEqual([personal.publicId, work.publicId]);
    const opened = await sandboxOf(first.computer.id);
    expect(opened.profile).toBe(FIRST_PROFILE);
    expect(values(opened.cookies)).toEqual(['personal']);
    // Naming the other runs Chrome on a profile of its own, signed in as that person; the first keeps its sign-in.
    const second = await openWith(a, {
      computerId: first.computer.id,
      sessionId: first.sessionId,
      profile: work.publicId,
    });
    expect(second.profile).toMatchObject({ id: work.publicId, default: false });
    expect(second.sync).toMatchObject({ status: 'applied', sitesUpdated: 1 });
    expect(opened.profile).toBe(work.publicId);
    expect(values(opened.cookies)).toEqual(['work']);
    expect(values(opened.profiles[FIRST_PROFILE])).toEqual(['personal']);
    // A sync from one browser changes nothing in the other's profile, and a reopen without a profile keeps the
    // computer's, though the other browser synced since.
    await saveFromBrowser(db, a, bundle([cookie({ value: 'personal again' })]), { browser: personal.id });
    const kept = await openWith(a, { computerId: first.computer.id, sessionId: second.sessionId });
    expect(kept.profile?.id).toBe(work.publicId);
    expect(kept.sync).toMatchObject({ status: 'unchanged' });
    expect(values(opened.cookies)).toEqual(['work']);
    expect(values(opened.profiles[FIRST_PROFILE])).toEqual(['personal']);
    const back = await openWith(a, {
      computerId: first.computer.id,
      sessionId: kept.sessionId,
      profile: personal.publicId,
    });
    expect(back.sync).toMatchObject({ status: 'applied', sitesUpdated: 1 });
    expect(values(opened.cookies)).toEqual(['personal again']);
    expect(values(opened.profiles[work.publicId])).toEqual(['work']);
    // A new computer gets the default again.
    expect((await openWith(a)).profile?.id).toBe(personal.publicId);
    // Each session records its profile, and Chrome ran each.
    expect(await sessionProfiles()).toEqual([personal.id, work.id, work.id, personal.id, personal.id]);
    expect(fake.calls.profiles.map(call => call.profile)).toEqual([
      FIRST_PROFILE,
      work.publicId,
      work.publicId,
      FIRST_PROFILE,
      FIRST_PROFILE,
    ]);
  });
  it("refuses a profile that is unknown, another member's, or no longer syncing, before making a computer", async () => {
    const a = await user('a');
    const b = await user('b');
    const mine = await signIn(a, 'work');
    const theirs = await signIn(b, 'work');
    const removed = await signIn(a, 'removed');
    const signedOut = await signIn(a, 'signed-out');
    expect(await removeBrowser(db, a, removed.publicId)).toBe(true);
    await db
      .update(schema.connectedBrowsers)
      .set({ disconnectedAt: new Date() })
      .where(eq(schema.connectedBrowsers.id, signedOut.id));
    for (const profile of [newPublicId('browser'), theirs.publicId, removed.publicId, signedOut.publicId, 'brw_x'])
      expect(await openComputerSession(db, computers, caller(a), { profile }), profile).toMatchObject({
        error: 'profile_not_found',
      });
    expect(await db.select().from(schema.computers)).toEqual([]);
    expect(await sessions()).toEqual([]);
    expect((await openWith(a, { profile: mine.publicId })).profile?.id).toBe(mine.publicId);
  });
  it("signs a browser's profile out of what it synced once it stops syncing, on each computer's next open", async () => {
    const a = await user('a');
    const work = await signIn(a, 'work');
    const opened = await openWith(a, { profile: work.publicId });
    const computer = await sandboxOf(opened.computer.id);
    expect(opened.sync).toMatchObject({ status: 'applied' });
    const personal = await signIn(a, 'personal');
    // A site only the computer signed in to, in the work profile, which stays.
    computer.cookies.push({
      name: 'sid',
      value: 'own',
      url: 'https://own.test/',
      path: '/',
      secure: true,
      httpOnly: true,
    });
    const both = await openWith(a, {
      computerId: opened.computer.id,
      sessionId: opened.sessionId,
      profile: personal.publicId,
    });
    expect(await removeBrowser(db, a, work.publicId)).toBe(true);
    const next = await openWith(a, { computerId: opened.computer.id, sessionId: both.sessionId });
    expect(next.profile?.id).toBe(personal.publicId);
    expect(next.profiles.map(profile => profile.id)).toEqual([personal.publicId]);
    expect(next.sync).toMatchObject({ status: 'unchanged' });
    expect(values(computer.profiles[FIRST_PROFILE])).toEqual(['own']);
    expect(values(computer.cookies)).toEqual(['personal']);
    // A new computer never had the work profile, and gets only the personal one.
    const fresh = await openWith(a);
    const made = await sandboxOf(fresh.computer.id);
    expect(made.profile).toBe(FIRST_PROFILE);
    expect(values(made.cookies)).toEqual(['personal']);
  });
  it('fails the open rather than give the session another profile when Chrome cannot switch', async () => {
    const a = await user('a');
    await signIn(a, 'work');
    fake.failUseProfile();
    await expect(openComputerSession(db, computers, caller(a))).rejects.toThrow('useProfile failed');
    expect(fake.calls.sync).toBe(0);
    expect(await sessions()).toMatchObject([{ endReason: 'closed' }]);
  });
});

describe('metering', () => {
  const usedUp: MeteringRefusal = { message: 'Used up.', resetsAt: new Date('2026-11-01T00:00:00Z') };
  it('refuses to create, wake, or use a computer while metering refuses, and books nothing for refusals', async () => {
    const a = await user('a');
    const b = await user('b');
    const opened = await open(a);
    const booked = await used(a);
    refusal = usedUp;
    expect(await useComputerSession(db, computers, caller(a), opened.sessionId)).toEqual({
      error: 'credit_exhausted',
      ...usedUp,
    });
    expect(await openComputerSession(db, computers, caller(a, 'chatgpt'))).toMatchObject({
      error: 'credit_exhausted',
    });
    expect(
      await openComputerSession(db, computers, caller(a, 'chatgpt'), { computerId: opened.computer.id }),
    ).toMatchObject({ error: 'credit_exhausted' });
    expect(await openComputerSession(db, computers, caller(b))).toMatchObject({ error: 'credit_exhausted' });
    expect(fake.calls.create).toBe(1);
    expect(await used(a)).toEqual(booked);
    refusal = null;
    expect(await use(a, opened.sessionId)).not.toHaveProperty('error');
  });
  it('runs with no allowance under the default hooks', async () => {
    const a = await user('a');
    const defaults = { provider: fake.provider, metering: noMetering };
    const opened = await openComputerSession(db, defaults, caller(a));
    if ('error' in opened) throw new Error(opened.error);
    await opened.done();
    expect(await closeComputerSession(db, defaults, caller(a), opened.sessionId)).toEqual({ closed: true });
    expect((await computerView(db, defaults, a)).usage).toBeNull();
    expect(
      await liveViewStatus(db, noMetering, a, randomUUID(), new Date(), { computerId: opened.computer.id }),
    ).not.toHaveProperty('creditExhausted');
  });
});

describe('live view', () => {
  const lease = () => randomUUID();
  type Target = { computerId: string };
  const beat = (member: Member, id: string, state: 'visible' | 'hidden' | 'released', target: Target) =>
    liveViewHeartbeat(db, computers, member, { id, state }, new Date(), target);
  const takeOver = async (member: Member, id: string, target: Target) => {
    const status = await takeOverComputer(db, computers, member, id, target);
    if ('error' in status) throw new Error(status.error);
    return status;
  };
  // A paused computer of the member's, with no agent on it.
  const pausedComputer = async (member: Member): Promise<Target> => {
    const made = await createPausedComputer(db, computers, member);
    if ('error' in made) throw new Error(made.error);
    return made;
  };
  it('suspends the agent for a takeover of its computer, and resumes it with its idle clock shifted and no apply', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const claudeCode = 'https://claude.ai/oauth/claude-code-client-metadata';
    await db.insert(schema.oauthClient).values({ id: randomUUID(), clientId: claudeCode, redirectUris: [] });
    const agent = await open(a, claudeCode);
    const target = { computerId: agent.computer.id };
    await saveFromBrowser(db, a, bundle([cookie()]));
    const page = lease();
    at('2026-10-20T12:00:20Z');
    expect(await takeOver(a, page, target)).toEqual({
      computer: 'running',
      watching: true,
      takeover: { mine: true, since: '2026-10-20T12:00:20.000Z' },
      agentWaiting: null,
    });
    // Nothing is applied under the agent's session.
    expect(fake.calls.sync).toBe(0);
    expect(await sessionRow(agent.sessionId)).toMatchObject({ suspendedAt: new Date('2026-10-20T12:00:20Z') });
    expect(await liveViewAccess(db, a, page, undefined, target)).toBe('control');
    expect(await liveViewAccess(db, a, lease(), undefined, target)).toBe('none');
    at('2026-10-20T12:00:30Z');
    const waiting = await useComputerSession(db, computers, caller(a, claudeCode), agent.sessionId);
    expect(waiting).toMatchObject({ error: 'user_in_control' });
    expect(waiting).not.toHaveProperty('busyUntil');
    expect(
      await openComputerSession(db, computers, caller(a, claudeCode), { sessionId: agent.sessionId }),
    ).toMatchObject({ error: 'user_in_control' });
    const busy = await openComputerSession(db, computers, caller(a, 'chatgpt'), target);
    expect(busy).toMatchObject({ error: 'busy' });
    expect(busy).not.toHaveProperty('busyUntil');
    expect(await listComputers(db, computers, a)).toEqual([expect.objectContaining({ status: 'in_use' })]);
    // The MCP layer records the agent's user_in_control call; the page names the waiting agent from it.
    const { id: sessionKey } = await sessionRow(agent.sessionId);
    await db.insert(schema.toolCalls).values({
      membershipId: a.membershipId,
      clientId: claudeCode,
      computerSessionId: sessionKey,
      tool: 'computer_screenshot',
      startedAt: new Date(),
      endedAt: new Date(),
      error: 'user_in_control',
    });
    expect((await liveViewStatus(db, metering, a, page, undefined, target)).agentWaiting).toEqual({
      agent: 'claude-code',
      host: 'claude.ai',
      since: '2026-10-20T12:00:30.000Z',
    });
    // Another page of the user's sees the takeover as not its own.
    expect((await liveViewStatus(db, metering, a, lease(), undefined, target)).takeover).toEqual({
      mine: false,
      since: '2026-10-20T12:00:20.000Z',
    });
    at('2026-10-20T12:01:00Z');
    expect(await handBackComputer(db, computers, a, page, target)).toMatchObject({
      takeover: null,
      agentWaiting: null,
      watching: true,
    });
    // Idle 20 s when suspended, so 20 s at the hand-back.
    expect(await sessionRow(agent.sessionId)).toMatchObject({
      suspendedAt: null,
      handedBackAt: new Date('2026-10-20T12:01:00Z'),
      lastCallAt: new Date('2026-10-20T12:00:40Z'),
    });
    expect(await openComputerSession(db, computers, caller(a, 'chatgpt'), target)).toMatchObject({
      error: 'busy',
      busyUntil: new Date('2026-10-20T12:01:40Z'),
    });
    expect(await use(a, agent.sessionId, claudeCode)).toMatchObject({ userHadControl: true });
    expect(await use(a, agent.sessionId, claudeCode)).not.toHaveProperty('userHadControl');
    expect(fake.calls.sync).toBe(0);
    expect(await liveViewAccess(db, a, page, undefined, target)).toBe('view');
  });
  it('ends a lapsed takeover lazily, resuming the session as of the lapse', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const agent = await open(a, 'claude');
    const target = { computerId: agent.computer.id };
    const page = lease();
    at('2026-10-20T12:00:10Z');
    await takeOver(a, page, target);
    expect(await computerRow()).toMatchObject({ takeoverUntil: new Date('2026-10-20T12:01:25Z') });
    // Past the lapse, readers treat it as ended before anything writes.
    at('2026-10-20T12:01:25Z');
    expect(await liveViewStatus(db, metering, a, page, undefined, target)).toMatchObject({
      takeover: null,
      watching: false,
    });
    expect(await liveViewAccess(db, a, page, undefined, target)).toBe('none');
    at('2026-10-20T12:03:00Z');
    expect(await use(a, agent.sessionId, 'claude')).toMatchObject({ userHadControl: true });
    expect(await computerRow()).toMatchObject({ takeoverLease: null, takenOverAt: null, takeoverUntil: null });
    // Suspended 10 s after its last call; resumed at the lapse (12:01:25), then the 12:03:00 call ran.
    expect(await sessionRow(agent.sessionId)).toMatchObject({
      handedBackAt: null,
      lastCallAt: new Date('2026-10-20T12:03:00Z'),
    });
  });
  it('treats a takeover with no agent working like computer_open, without marking setup', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    await saveFromBrowser(db, a, bundle([cookie()]));
    await setTimeZone(db, a.userId, 'Europe/London');
    const page = lease();
    const made = await pausedComputer(a);
    expect(fake.calls.create).toBe(1);
    expect(fake.calls.sync).toBe(1);
    // Applies what changed since (nothing), and the time zone.
    expect(await takeOver(a, page, made)).toMatchObject({ computer: 'running', takeover: { mine: true } });
    expect(fake.calls.create).toBe(1);
    expect(fake.calls.sync).toBe(1);
    expect(sandbox()).toMatchObject({ timeZone: 'Europe/London' });
    expect(sandbox().cookies.map(entry => entry.name)).toEqual(['sid']);
    expect(await db.select().from(schema.setups)).toEqual([]);
    at('2026-10-20T12:00:30Z');
    await handBackComputer(db, computers, a, page, made);
    const agent = await open(a, 'claude');
    const target = { computerId: agent.computer.id };
    const synced = fake.calls.sync;
    // An agent idle past its minute, but not ended, is still working: the next takeover of its computer suspends it, no apply.
    at('2026-10-20T12:05:00Z');
    await saveFromBrowser(db, a, bundle([cookie({ value: 'new' })]));
    await takeOver(a, page, target);
    expect(fake.calls.sync).toBe(synced);
    expect(await sessionRow(agent.sessionId)).toMatchObject({ suspendedAt: new Date('2026-10-20T12:05:00Z') });
    // An agent idle 10 minutes is over: it ends, and the takeover applies.
    at('2026-10-20T12:05:10Z');
    await handBackComputer(db, computers, a, page, target);
    at('2026-10-20T12:16:00Z');
    await takeOver(a, page, target);
    expect(await sessionRow(agent.sessionId)).toMatchObject({ endReason: 'idle' });
    expect(fake.calls.sync).toBe(synced + 1);
  });
  it('runs a takeover to its lapse, extends it every few beats, and meters it until the release pauses it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const page = lease();
    const made = await pausedComputer(a);
    const before = {
      timeouts: fake.calls.timeouts.length,
      pause: fake.calls.pause,
      providerTimeouts: fake.calls.providerTimeouts.length,
    };
    await takeOver(a, page, made);
    // To the takeover's lapse at 12:01:15.
    expect(fake.calls.timeouts.slice(before.timeouts)).toEqual([75_000]);
    expect(await used(a)).toEqual([]);
    at('2026-10-20T12:00:10Z');
    await beat(a, page, 'visible', made);
    // More than the lapse left: nothing written, metered, or connected.
    expect(fake.calls.timeouts.slice(before.timeouts)).toHaveLength(1);
    expect(await used(a)).toEqual([]);
    at('2026-10-20T12:00:20Z');
    expect(await beat(a, page, 'visible', made)).toMatchObject({ takeover: { mine: true }, watching: true });
    expect(await computerRow()).toMatchObject({ takeoverUntil: new Date('2026-10-20T12:01:35Z') });
    expect(fake.calls.timeouts.slice(before.timeouts)).toEqual([75_000, 75_000]);
    expect(await used(a)).toEqual([['2026-10-20', 20]]);
    // Hand-back keeps the page watching, so the computer runs to the watch's lapse.
    at('2026-10-20T12:00:30Z');
    await handBackComputer(db, computers, a, page, made);
    expect(fake.calls.pause).toBe(before.pause);
    expect(fake.calls.providerTimeouts.slice(before.providerTimeouts)).toEqual([65_000]);
    expect((await computerRow()).runsUntil).toEqual(new Date('2026-10-20T12:01:35Z'));
    // Leaving the page pauses the computer at once, which books its running time.
    at('2026-10-20T12:00:40Z');
    expect(await beat(a, page, 'released', made)).toMatchObject({
      computer: 'paused',
      watching: false,
      takeover: null,
    });
    expect(fake.calls.pause).toBe(before.pause + 1);
    expect(sandbox()).toMatchObject({ paused: true });
    expect(await used(a)).toEqual([['2026-10-20', 40]]);
  });
  it('wakes a paused computer for a watch, keeps it running past an agent close, and lapses a hidden page', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const page = lease();
    const agent = await open(a);
    const target = { computerId: agent.computer.id };
    await closeComputerSession(db, computers, caller(a), agent.sessionId);
    expect(sandbox()).toMatchObject({ paused: true });
    at('2026-10-20T12:00:10Z');
    expect(await beat(a, page, 'visible', target)).toMatchObject({ computer: 'running', watching: true });
    expect(sandbox()).toMatchObject({ paused: false });
    expect((await computerRow()).runsUntil).toEqual(new Date('2026-10-20T12:01:25Z'));
    // The 10 seconds paused are not booked.
    expect(await used(a)).toEqual([]);
    // The relay connects for the watch, asking the provider to run the computer to the watch's lapse.
    expect(await connectLiveView(db, { provider: fake.provider }, a, page, target)).toHaveProperty('isPrivate', true);
    expect(fake.calls.timeouts.at(-1)).toBe(75_000);
    // Watching is not a session boundary: an agent reopens as usual, and its close leaves the computer running.
    const next = await open(a, 'claude', undefined, agent.computer.id);
    at('2026-10-20T12:00:20Z');
    const pauses = fake.calls.pause;
    await closeComputerSession(db, computers, caller(a, 'claude'), next.sessionId);
    expect(fake.calls.pause).toBe(pauses);
    expect(fake.calls.providerTimeouts.at(-1)).toBe(65_000);
    expect((await computerRow()).runsUntil).toEqual(new Date('2026-10-20T12:01:25Z'));
    expect(await used(a)).toEqual([['2026-10-20', 10]]);
    // Hidden: the watch lapses a minute from now instead, and the provider follows.
    at('2026-10-20T12:00:30Z');
    await beat(a, page, 'visible', target);
    expect((await computerRow()).runsUntil).toEqual(new Date('2026-10-20T12:01:45Z'));
    at('2026-10-20T12:00:35Z');
    expect(await beat(a, page, 'hidden', target)).toMatchObject({ watching: true });
    expect(fake.calls.providerTimeouts.at(-1)).toBe(60_000);
    expect((await computerRow()).runsUntil).toEqual(new Date('2026-10-20T12:01:35Z'));
    at('2026-10-20T12:01:35Z');
    expect(await beat(a, page, 'hidden', target)).toMatchObject({ watching: false });
    // A watch never creates a computer.
    expect(await beat(a, lease(), 'visible', { computerId: newPublicId('computer') })).toMatchObject({
      computer: 'none',
    });
  });
  it("keeps each page's watch, moves a takeover to the latest page, and ignores another page's release", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const b = await user('b');
    const made = await pausedComputer(a);
    const before = { pause: fake.calls.pause, providerTimeouts: fake.calls.providerTimeouts.length };
    const [first, second] = [lease(), lease()];
    await takeOver(a, first, made);
    await beat(a, second, 'visible', made);
    at('2026-10-20T12:00:10Z');
    expect(await takeOver(a, second, made)).toMatchObject({
      takeover: { mine: true, since: '2026-10-20T12:00:00.000Z' },
    });
    expect(await liveViewAccess(db, a, first, undefined, made)).toBe('view');
    expect(await liveViewAccess(db, a, second, undefined, made)).toBe('control');
    // Another user's lease never controls or reaches this computer.
    expect(await liveViewAccess(db, b, second, undefined, made)).toBe('none');
    expect(await handBackComputer(db, computers, a, first, made)).toMatchObject({ takeover: { mine: false } });
    expect(await beat(a, first, 'released', made)).toMatchObject({ watching: false, takeover: { mine: false } });
    expect(await liveViewAccess(db, a, second, undefined, made)).toBe('control');
    // The second page's takeover still holds the computer to 12:01:25.
    expect(fake.calls.pause).toBe(before.pause);
    expect(fake.calls.providerTimeouts.slice(before.providerTimeouts)).toEqual([75_000]);
    expect(await beat(a, second, 'released', made)).toMatchObject({ watching: false, takeover: null });
    expect(fake.calls.pause).toBe(before.pause + 1);
  });
  it('lets an agent close its suspended session without touching the computer', async () => {
    const a = await user('a');
    const agent = await open(a, 'claude');
    const target = { computerId: agent.computer.id };
    const page = lease();
    await takeOver(a, page, target);
    const before = { ...fake.calls, timeouts: fake.calls.timeouts.length };
    expect(await closeComputerSession(db, computers, caller(a, 'claude'), agent.sessionId)).toEqual({ closed: true });
    expect(await sessionRow(agent.sessionId)).toMatchObject({ endReason: 'closed' });
    expect({ ...fake.calls, timeouts: fake.calls.timeouts.length }).toEqual(before);
    expect(await liveViewAccess(db, a, page, undefined, target)).toBe('control');
  });
  it('refuses a takeover and stops extending holds once metering refuses, so they lapse', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const page = lease();
    const made = await pausedComputer(a);
    await takeOver(a, page, made);
    refusal = { message: 'Used up.', resetsAt: new Date('2026-11-01T00:00:00Z') };
    expect(await takeOverComputer(db, computers, a, lease(), made)).toMatchObject({
      error: 'credit_exhausted',
      resetsAt: new Date('2026-11-01T00:00:00Z'),
    });
    at('2026-10-20T12:00:30Z');
    expect(await beat(a, page, 'visible', made)).toMatchObject({
      takeover: { mine: true },
      creditExhausted: { resetsAt: '2026-11-01T00:00:00.000Z' },
    });
    expect(await computerRow()).toMatchObject({ takeoverUntil: new Date('2026-10-20T12:01:15Z') });
    at('2026-10-20T12:01:15Z');
    expect(await beat(a, page, 'visible', made)).toMatchObject({ takeover: null, watching: false });
    expect(await computerRow()).toMatchObject({ takeoverLease: null });
  });
  it('ends every hold and session with the computer when all computers are deleted during a takeover', async () => {
    const a = await user('a');
    const agent = await open(a, 'claude');
    const target = { computerId: agent.computer.id };
    const page = lease();
    await takeOver(a, page, target);
    expect(await deleteAllComputers(db, computers, a)).toBe(1);
    expect(await liveViewAccess(db, a, page, undefined, target)).toBe('none');
    expect(await beat(a, page, 'released', target)).toMatchObject({ computer: 'none', takeover: null });
    expect(await use(a, agent.sessionId, 'claude')).toMatchObject({ error: 'session_not_found' });
    expect(await takeOverComputer(db, computers, a, page, target)).toMatchObject({ error: 'computer_not_found' });
  });
  it('keeps the hand-back notice until a call after it can run, and gives it to a reopen of the same session', async () => {
    const a = await user('a');
    const agent = await open(a, 'claude');
    const target = { computerId: agent.computer.id };
    const page = lease();
    await takeOver(a, page, target);
    await handBackComputer(db, computers, a, page, target);
    vi.spyOn(fake.provider, 'connect').mockRejectedValueOnce(new Error('unreachable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(use(a, agent.sessionId, 'claude')).rejects.toThrow('unreachable');
    expect(await sessionRow(agent.sessionId)).toMatchObject({ handedBackAt: expect.any(Date) });
    expect(await use(a, agent.sessionId, 'claude')).toMatchObject({ userHadControl: true });
    expect(await use(a, agent.sessionId, 'claude')).not.toHaveProperty('userHadControl');
    // Reopening with its session_id right after a hand-back says so too; reopening again does not.
    await takeOver(a, page, target);
    await handBackComputer(db, computers, a, page, target);
    const reopened = await open(a, 'claude', agent.sessionId);
    expect(reopened).toMatchObject({ userHadControl: true });
    expect(await open(a, 'claude', reopened.sessionId)).not.toHaveProperty('userHadControl');
  });
  it('ignores a visible beat for a lease its page just released, and caps the watches a user can hold', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const target = { computerId: (await open(a)).computer.id };
    const page = lease();
    expect(await beat(a, page, 'visible', target)).toMatchObject({ watching: true });
    // The page closed: its release lands, then a visible beat it sent just before.
    at('2026-10-20T12:00:01Z');
    await beat(a, page, 'released', target);
    const connects = fake.calls.timeouts.length;
    expect(await beat(a, page, 'visible', target)).toMatchObject({ watching: false });
    expect(fake.calls.timeouts).toHaveLength(connects);
    // A lease released before it ever watched is remembered too (a page that left at once).
    const gone = lease();
    await beat(a, gone, 'released', target);
    expect(await beat(a, gone, 'visible', target)).toMatchObject({ watching: false });
    // Eight pages watch; a ninth does not, and adding the eighth at the same moment asked the provider for nothing.
    const pages = Array.from({ length: 8 }, lease);
    for (const id of pages.slice(0, 7)) expect(await beat(a, id, 'visible', target)).toMatchObject({ watching: true });
    const before = fake.calls.timeouts.length;
    expect(await beat(a, pages[7]!, 'visible', target)).toMatchObject({ watching: true });
    expect(fake.calls.timeouts).toHaveLength(before);
    expect(await beat(a, lease(), 'visible', target)).toMatchObject({ watching: false });
    // Releases are forgotten once no beat from before them could still arrive.
    at('2026-10-20T12:01:02Z');
    await beat(a, pages[0]!, 'visible', target);
    expect(Object.keys((await computerRow()).liveViewWatches).sort()).toEqual([...pages].sort());
  });
  it("sets the computer's clipboard only for the lease holding a live takeover, to text or a PNG image", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-10-20T12:00:00Z');
    const a = await user('a');
    const b = await user('b');
    const page = lease();
    const target = await pausedComputer(a);
    const paste = (member: Member, id: string, content: ClipboardContent) =>
      setLiveViewClipboard(db, { provider: fake.provider }, member, id, content, target);
    // A PNG's signature and header, then zeros.
    const png = (size: number) => {
      const bytes = new Uint8Array(size);
      bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]);
      return bytes;
    };
    expect(await paste(a, page, 'x')).toBe('not_in_control');
    await beat(a, page, 'visible', target);
    // Watching is not control.
    expect(await paste(a, page, 'x')).toBe('not_in_control');
    await takeOver(a, page, target);
    const before = fake.calls.timeouts.length;
    expect(await paste(a, page, '日本語 🎉')).toBe('set');
    expect(sandbox().clipboard).toBe('日本語 🎉');
    // Connecting asks the provider for no more than the takeover already asked for.
    expect(fake.calls.timeouts.slice(before)).toEqual([(await computerRow()).takeoverUntil!.getTime() - Date.now()]);
    expect(await paste(a, lease(), 'other page')).toBe('not_in_control');
    expect(await paste(b, page, 'other user')).toBe('not_in_control');
    expect(await paste(a, page, '€'.repeat(Math.floor(MAX_CLIPBOARD_BYTES / 3) + 1))).toBe('too_large');
    expect(sandbox().clipboard).toBe('日本語 🎉');
    // A failure on the computer reaches the caller, which reports it.
    fake.failClipboard();
    await expect(paste(a, page, 'x')).rejects.toThrow('setClipboard failed');
    fake.failClipboard(false);
    // An image up to MAX_CLIPBOARD_IMAGE_BYTES; a larger one, or one that isn't a PNG, never reaches the computer.
    const image = png(MAX_CLIPBOARD_IMAGE_BYTES);
    expect(await paste(a, page, { png: image })).toBe('set');
    expect((sandbox().clipboard as { png: Uint8Array }).png).toBe(image);
    expect(await paste(a, page, { png: png(MAX_CLIPBOARD_IMAGE_BYTES + 1) })).toBe('too_large');
    expect(await paste(a, page, { png: new TextEncoder().encode('GIF89a not a png') })).toBe('not_png');
    expect(await paste(a, lease(), { png: image })).toBe('not_in_control');
    // A lapsed takeover is no longer control.
    at('2026-10-20T12:05:00Z');
    expect(await paste(a, page, 'late')).toBe('not_in_control');
    expect((sandbox().clipboard as { png: Uint8Array }).png).toBe(image);
  });
  it('refuses live view on a computer that accepts public traffic, until the member makes a new one', async () => {
    const a = await user('a');
    const opened = await open(a);
    const target = { computerId: opened.computer.id };
    (await sandboxOf(opened.computer.id)).public = true;
    const page = lease();
    expect(await takeOverComputer(db, computers, a, page, target)).toMatchObject({ error: 'needs_reset' });
    expect(await computerRow()).toMatchObject({ takeoverLease: null });
    await beat(a, page, 'visible', target);
    expect(await connectLiveView(db, { provider: fake.provider }, a, page, target)).toBe('needs_reset');
    await deleteAllComputers(db, computers, a);
    const next = await pausedComputer(a);
    expect(await takeOver(a, page, next)).toMatchObject({ takeover: { mine: true } });
  });
  it('rolls the takeover back when the computer cannot be reached', async () => {
    const a = await user('a');
    const agent = await open(a, 'claude');
    const target = { computerId: agent.computer.id };
    vi.spyOn(fake.provider, 'connect').mockRejectedValueOnce(new Error('unreachable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const page = lease();
    await expect(takeOverComputer(db, computers, a, page, target)).rejects.toThrow('unreachable');
    expect(await liveViewAccess(db, a, page, undefined, target)).toBe('none');
    expect(await sessionRow(agent.sessionId)).toMatchObject({ suspendedAt: null, endedAt: null });
  });
  it('runs each lease of a heartbeat through its kind and refuses unknown kinds', async () => {
    const a = await user('a');
    const computer = (await open(a)).computer.id;
    const [first, second] = [lease(), lease()];
    const parses = (body: unknown) => heartbeatSchema.safeParse({ leases: [body] }).success;
    expect(parses({ kind: 'chat', id: first, state: 'visible', computer })).toBe(false);
    expect(parses({ kind: 'live-view', id: 'x', state: 'visible', computer })).toBe(false);
    // A lease is always on one computer.
    expect(parses({ kind: 'live-view', id: first, state: 'visible' })).toBe(false);
    const body = heartbeatSchema.parse({
      leases: [
        { kind: 'live-view', id: first, state: 'visible', computer },
        { kind: 'live-view', id: second, state: 'hidden', computer },
      ],
    });
    expect(await heartbeat(db, computers, a, body)).toEqual({
      leases: [
        { kind: 'live-view', id: first, status: expect.objectContaining({ watching: true }) },
        { kind: 'live-view', id: second, status: expect.objectContaining({ watching: false }) },
      ],
    });
  });
});

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { builtInVerifiedServers } from '@clutchbox/capture';
import { databaseSchema } from '@clutchbox/server/database-schema';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../../server/src/auth.ts';
import { connectBrowser, saveFromBrowser, type Tokens } from '../../server/src/browser-fixtures.ts';
import { ensureExtensionClient } from '../../server/src/browsers.ts';
import { bundle, cookie, siteBundle } from '../../server/src/capture-fixtures.ts';
import { adoptSyncSettings, captureView, syncView } from '../../server/src/captures.ts';
import { LIVE_VIEW_TICKET_MS } from '../../server/src/computer-timing.ts';
import type { ComputerProvider } from '../../server/src/computers.ts';
import {
  createPausedComputer,
  MAX_CLIPBOARD_IMAGE_BYTES,
  openComputerSession,
  useComputerSession,
} from '../../server/src/computers.ts';
import type { ServerConfig } from '../../server/src/config.ts';
import type { Database } from '../../server/src/database.ts';
import { fakeComputerProvider } from '../../server/src/fake-computer-provider.ts';
import { type MeteringRefusal, noLimits, noMetering, noOperatorAdmin } from '../../server/src/hooks.ts';
import { newPublicId } from '../../server/src/ids.ts';
import { inTheOrganization, membership } from '../../server/src/member-fixtures.ts';
import { createOrganization, currentMember } from '../../server/src/organizations.ts';
import * as schema from '../../server/src/schema.ts';
import { recordSetupStep, setupView } from '../../server/src/setup.ts';
import { createApi } from './index.ts';

// Every /api/v1 route over HTTP, in process: session, origin, validation, status codes, and ownership.
// The services behind them are tested in packages/server; this covers the route layer on top.
const origin = 'http://localhost:3099';
const extension = `chrome-extension://${'a'.repeat(32)}`;
const config: ServerConfig = {
  APP_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost/synthetic',
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'),
  GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'synthetic-only',
};
let pg: PGlite;
let db: Database;
let auth: ReturnType<typeof createAuth>;
let fake: ReturnType<typeof fakeComputerProvider>;
async function identity(id: string) {
  const person = { id, name: `Fixture ${id}`, email: `${id}@example.test` };
  await db.insert(schema.user).values({ ...person, emailVerified: true });
  // Into the deployment's organization, as sign-up does.
  await inTheOrganization(db, person);
  const token = randomBytes(32).toString('base64url');
  await db
    .insert(schema.session)
    .values({ id: randomUUID(), userId: id, token, expiresAt: new Date(Date.now() + 3600_000) });
  const signature = createHmac('sha256', config.BETTER_AUTH_SECRET).update(token).digest('base64');
  return `${(await auth.$context).authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`;
}
// A computer session for the person, as an agent's computer_open makes.
const openAs = async (userId: string) =>
  openComputerSession(
    db,
    { provider: fake.provider, metering: noMetering },
    { ...(await member(userId)), clientId: 'agent-client' },
  );
// A paused computer of the person's, with no agent; its ID.
const newComputer = async (userId: string) => {
  const made = await createPausedComputer(db, { provider: fake.provider, metering: noMetering }, await member(userId));
  if ('error' in made) throw new Error(made.error);
  return made.computerId;
};
function client(
  computers: ComputerProvider = fake.provider,
  options: Omit<Parameters<typeof createApi>[0], 'db' | 'auth' | 'origin' | 'computers'> = {},
) {
  const api = createApi({ db, auth, origin, computers, ...options });
  return (
    method: string,
    path: string,
    {
      cookie,
      token,
      from = token ? extension : origin,
      body,
      version,
    }: { cookie?: string; token?: Tokens; from?: string | null; body?: unknown; version?: string } = {},
  ) =>
    api.request(`${origin}/api/v1${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(token ? { authorization: `Bearer ${token.access_token}` } : {}),
        ...(version ? { 'x-extension-version': version } : {}),
        ...(from ? { origin: from } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
}
// The extension's connection for a signed-in user: uploads and its settings changes take its token.
const browser = (cookie: string) => connectBrowser(auth, cookie, { extensionOrigin: extension });
// Migrate once per file and give each test a clone, which is much faster than a new database.
// The member a person acts as, which the routes resolve from the session.
const member = async (userId: string) => (await currentMember(db, userId))!;
let template: PGlite;
beforeAll(async () => {
  template = new PGlite();
  const templateDb = drizzle(template, { schema: databaseSchema });
  await migrate(templateDb, { migrationsFolder: fileURLToPath(new URL('../../server/migrations', import.meta.url)) });
  await ensureExtensionClient(templateDb as unknown as Database, extension);
});
afterAll(() => template.close());
beforeEach(async () => {
  pg = (await template.clone()) as PGlite;
  const embedded = drizzle(pg, { schema: databaseSchema });
  db = embedded as unknown as Database;
  await db.insert(schema.installation).values({ dataClass: 'nonproduction' });
  auth = createAuth(db, config);
  await auth.$context;
  fake = fakeComputerProvider();
  // Computer sessions reference their OAuth client.
  await db.insert(schema.oauthClient).values({ id: 'agent-client', clientId: 'agent-client', redirectUris: [] });
  vi.stubEnv('CAPTURE_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('EXTENSION_ORIGINS', extension);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await pg.close();
});

describe('API routes', () => {
  it('require a session on every route and the web origin on every change', async () => {
    const request = client();
    const a = await identity('a');
    const routes = [
      ['GET', '/me'],
      ['GET', '/mcp/grants'],
      ['POST', '/mcp/revoke'],
      ['POST', '/mcp/grants/revoke'],
      ['GET', '/setup'],
      ['POST', '/setup/notice/close'],
      ['PUT', '/time-zone'],
      ['GET', '/computer'],
      ['DELETE', '/computer'],
      ['POST', '/computer/computers'],
      ['DELETE', '/computer/computers'],
      ['DELETE', '/computer/computers/cmp_x'],
      ['PUT', '/computer/size'],
      ['PUT', '/computer/screen'],
      ['POST', '/computer/takeover'],
      ['POST', '/computer/hand-back'],
      ['POST', '/computer/clipboard'],
      ['POST', '/computer/clipboard/ticket'],
      ['POST', '/heartbeat'],
      ['POST', '/captures'],
      ['DELETE', '/captures'],
      ['GET', '/sync'],
      ['PATCH', '/sync'],
      ['POST', '/sync/adopt'],
      ['POST', '/sync/disconnect'],
      ['GET', '/browsers'],
      ['POST', '/browsers/disconnect'],
    ] as const;
    for (const [method, path] of routes) {
      expect((await request(method, path)).status, `${method} ${path} without a session`).toBe(401);
      if (method === 'GET') continue;
      for (const from of ['https://evil.test', `${origin}.evil.test`, null])
        expect((await request(method, path, { cookie: a, from })).status, `${method} ${path} from ${from}`).toBe(403);
    }
    // From the pinned extension, only a sync token works (extension-oauth.test.ts): on the extension's routes, the web
    // session gets an update prompt, and other changes are refused.
    for (const [method, path] of routes)
      if (method !== 'GET')
        expect((await request(method, path, { cookie: a, from: extension })).status, `${method} ${path}`).toBe(
          ['/captures', '/sync', '/sync/adopt'].includes(path) ? 426 : 403,
        );
  });

  it("run a deployment's extension routes behind the same session, origin, and headers, without shadowing product routes", async () => {
    const request = client(fake.provider, {
      extend: app => {
        app.put('/extra', c => c.json({ user: c.get('principal').id }));
        app.get('/me', c => c.json({ shadowed: true }));
      },
    });
    const a = await identity('a');
    expect((await request('PUT', '/extra')).status).toBe(401);
    expect((await request('PUT', '/extra', { cookie: a, from: 'https://evil.test' })).status).toBe(403);
    const response = await request('PUT', '/extra', { cookie: a });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ user: 'a' });
    expect(await (await request('GET', '/me', { cookie: a })).json()).toMatchObject({ user: { id: 'a' } });
    expect((await client()('PUT', '/extra', { cookie: a })).status).toBe(404);
  });

  it('serve the verified servers to anyone, without a session, the same for everyone', async () => {
    const request = client();
    const a = await identity('a');
    for (const options of [{ from: null }, { from: extension }, { cookie: a }]) {
      const response = await request('GET', '/verified-servers', options);
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(await response.json()).toEqual({ servers: builtInVerifiedServers });
    }
    expect((await request('POST', '/verified-servers', { cookie: a })).status).toBe(404);
  });

  it('accept capture uploads from a connected browser, reject malformed or oversized ones, and keep them per user', async () => {
    const request = client();
    const a = await identity('a');
    const b = await identity('b');
    const ta = await browser(a);
    const capture = bundle([cookie(), cookie({ name: 'other', domain: '.github.com', hostOnly: false })]);
    const stored = await request('POST', '/captures', { token: ta, body: { capture } });
    expect(stored.status).toBe(200);
    expect(await stored.json()).toMatchObject({ status: 'stored', cookieCount: 2 });
    expect((await request('POST', '/captures', { token: ta, body: { capture } })).status).toBe(200);
    expect(
      (await request('POST', '/captures', { token: ta, body: { capture: { ...capture, schemaVersion: 1 } } })).status,
    ).toBe(400);
    expect(
      (await request('POST', '/captures', { token: ta, body: { capture, excludedDomains: ['bank.test'] } })).status,
    ).toBe(400);
    // Builds from before site selection upload whole-browser captures, and both scopes stay accepted.
    const sites = { mode: 'sites', sites: ['example.com', 'github.com'], excludedDomains: [] };
    expect(
      (await request('POST', '/captures', { token: ta, body: { capture: { ...capture, scope: sites } } })).status,
    ).toBe(200);
    expect(
      (
        await request('POST', '/captures', {
          token: ta,
          body: { capture: { ...capture, scope: { ...sites, sites: ['example.com'] } } },
        })
      ).status,
    ).toBe(400);
    expect((await request('POST', '/captures', { token: ta, body: 'not json' })).status).toBe(400);
    expect(
      (await request('POST', '/captures', { token: ta, body: { capture, padding: 'x'.repeat(4_000_001) } })).status,
    ).toBe(413);
    expect((await (await request('GET', '/computer', { cookie: a })).json()).capture).toMatchObject({ cookieCount: 2 });
    expect((await (await request('GET', '/computer', { cookie: b })).json()).capture).toBeNull();
    // The extension deletes its upload on disconnect.
    expect((await request('DELETE', '/captures', { token: ta })).status).toBe(200);
    expect((await (await request('GET', '/computer', { cookie: a })).json()).capture).toBeNull();
    const reconnected = await browser(a);
    vi.stubEnv('CAPTURE_ENCRYPTION_KEY', '');
    expect((await request('POST', '/captures', { token: reconnected, body: { capture } })).status).toBe(503);
  });

  it('offer the latest extension build on upload, and tell builds older than the minimum to update', async () => {
    const a = await browser(await identity('a'));
    const capture = bundle([cookie()]);
    const current = client(fake.provider, { extensionVersion: '0.6.0' });
    expect(await (await current('POST', '/captures', { token: a, body: { capture } })).json()).toMatchObject({
      status: 'stored',
      latestVersion: '0.6.0',
    });
    const strict = client(fake.provider, { extensionVersion: '0.6.0', minExtensionVersion: '0.5.0' });
    for (const version of [undefined, '0.4.9']) {
      const refused = await strict('POST', '/captures', {
        token: a,
        body: { capture },
        ...(version ? { version } : {}),
      });
      expect(refused.status, version).toBe(426);
      expect(await refused.json()).toEqual({ error: 'extension_outdated', latestVersion: '0.6.0' });
    }
    expect((await strict('POST', '/captures', { token: a, body: { capture }, version: '0.5.0' })).status).toBe(200);
    // Authentication is still checked first.
    expect((await strict('POST', '/captures', { body: { capture }, version: '0.4.0' })).status).toBe(401);
  });

  it('Delete everything removes the computer and synced data, keeps sync off until the extension reconnects, and leaves other users alone', async () => {
    const request = client();
    const a = await identity('a');
    const b = await identity('b');
    const capture = bundle([cookie()]);
    for (const user of [a, b])
      expect((await request('POST', '/captures', { token: await browser(user), body: { capture } })).status).toBe(200);
    await openComputerSession(
      db,
      { provider: fake.provider, metering: noMetering },
      { ...(await member('a')), clientId: 'agent-client' },
    );
    const now = new Date();
    const [ma, mb] = [await member('a'), await member('b')];
    await db.insert(schema.toolCalls).values(
      [ma, mb].map(({ membershipId }) => ({
        membershipId,
        clientId: 'agent-client',
        tool: 'computer_open',
        startedAt: now,
        endedAt: now,
      })),
    );
    expect((await request('DELETE', '/computer', { cookie: a })).status).toBe(200);
    expect(
      (await db.select({ membershipId: schema.toolCalls.membershipId }).from(schema.toolCalls)).map(
        row => row.membershipId,
      ),
    ).toEqual([mb.membershipId]);
    expect(await (await request('GET', '/computer', { cookie: a })).json()).toMatchObject({
      capture: null,
      computers: [],
    });
    expect(fake.calls.kill).toBe(1);
    expect((await (await request('GET', '/computer', { cookie: b })).json()).capture).toMatchObject({ cookieCount: 1 });
    // A browser connected since uploads only with `connect`, the first upload after Connect.
    const reconnected = await browser(a);
    const again = await request('POST', '/captures', { token: reconnected, body: { capture: bundle([cookie()]) } });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'sync_disconnected' });
    expect(
      (await request('POST', '/captures', { token: reconnected, body: { capture: bundle([cookie()]), connect: true } }))
        .status,
    ).toBe(200);
  });

  it('let the extension adopt and change sync settings, and the account page only narrow them, per user', async () => {
    const request = client(fake.provider, { extensionVersion: '0.6.0' });
    const a = await identity('a');
    const b = await identity('b');
    const ta = await browser(a);
    const local = { sites: ['github.com', 'notion.so'], excludedDomains: ['bank.test'], paused: false };
    const body = async (response: Response) => ({ status: response.status, json: await response.json() });
    // The extension reads its config with the settings, before and after adoption.
    const empty = await body(await request('GET', '/sync', { cookie: a }));
    expect(empty).toMatchObject({ status: 200, json: { settings: null, disconnected: false, latestVersion: '0.6.0' } });
    expect(empty.json.config.suggestedSites.length).toBeGreaterThan(0);
    // Only the account page's narrowing works before adoption, and there is nothing to narrow yet.
    expect(await body(await request('PATCH', '/sync', { cookie: a, body: { removeSites: ['github.com'] } }))).toEqual({
      status: 409,
      json: { error: 'sync_settings_missing' },
    });
    // Adoption is the extension's alone, since it can add sites.
    expect((await request('POST', '/sync/adopt', { cookie: a, body: { settings: local } })).status).toBe(403);
    expect((await request('POST', '/sync/adopt', { token: ta, body: { settings: { sites: [] } } })).status).toBe(400);
    expect(await body(await request('POST', '/sync/adopt', { token: ta, body: { settings: local } }))).toEqual({
      status: 200,
      json: { settings: local },
    });
    // The account page may remove sites, edit exclusions, and pause, but not add sites or resume.
    for (const change of [{ addSites: ['x.com'] }, { paused: false }])
      expect(await body(await request('PATCH', '/sync', { cookie: a, body: change })), JSON.stringify(change)).toEqual({
        status: 403,
        json: { error: 'extension_only' },
      });
    expect((await request('PATCH', '/sync', { cookie: a, body: { removeSites: ['not a site'] } })).status).toBe(400);
    expect((await request('PATCH', '/sync', { cookie: a, body: { other: true } })).status).toBe(400);
    expect(
      await body(
        await request('PATCH', '/sync', {
          cookie: a,
          body: { removeSites: ['notion.so'], excludedDomains: [], paused: true },
        }),
      ),
    ).toEqual({ status: 200, json: { settings: { sites: ['github.com'], excludedDomains: [], paused: true } } });
    // The extension may add sites and resume.
    expect(
      await body(
        await request('PATCH', '/sync', {
          token: ta,
          body: { addSites: ['x.com', 'twitter.com'], paused: false },
        }),
      ),
    ).toEqual({
      status: 200,
      json: { settings: { sites: ['github.com', 'twitter.com', 'x.com'], excludedDomains: [], paused: false } },
    });
    // Uploads keep only allowed sites and answer with the settings.
    const capture = siteBundle(
      [cookie({ domain: 'github.com' }), cookie({ domain: 'notion.so' })],
      ['github.com', 'notion.so'],
    );
    expect(await body(await request('POST', '/captures', { token: ta, body: { capture } }))).toMatchObject({
      status: 200,
      json: { cookieCount: 1, settings: { sites: ['github.com', 'twitter.com', 'x.com'] } },
    });
    await request('PATCH', '/sync', { cookie: a, body: { paused: true } });
    expect(await body(await request('POST', '/captures', { token: ta, body: { capture } }))).toMatchObject({
      status: 409,
      json: { error: 'sync_paused', settings: { paused: true } },
    });
    // Each user sees only their own.
    expect((await body(await request('GET', '/sync', { cookie: b }))).json.settings).toBeNull();
    // Turning sync off on the account page keeps the settings and tells the extension.
    expect((await request('POST', '/sync/disconnect', { cookie: a })).status).toBe(200);
    expect((await body(await request('GET', '/sync', { cookie: a }))).json).toMatchObject({
      disconnected: true,
      settings: { sites: ['github.com', 'twitter.com', 'x.com'] },
    });
    expect((await (await request('GET', '/computer', { cookie: a })).json()).capture).toBeNull();
    // Delete everything forgets them.
    expect((await request('DELETE', '/computer', { cookie: a })).status).toBe(200);
    expect((await body(await request('GET', '/sync', { cookie: a }))).json.settings).toBeNull();
    const reconnected = await browser(a);
    vi.stubEnv('CAPTURE_ENCRYPTION_KEY', '');
    expect((await request('POST', '/sync/adopt', { token: reconnected, body: { settings: local } })).status).toBe(503);
    expect((await request('PATCH', '/sync', { cookie: a, body: { paused: true } })).status).toBe(503);
  });

  it('show each user their own setup checklist, and record browser sync once a site is added', async () => {
    const request = client();
    const a = await identity('a');
    const b = await identity('b');
    const setup = async (user: string) => (await request('GET', '/setup', { cookie: user })).json();
    expect(await setup(a)).toEqual({
      setUpAt: null,
      noticeOpen: false,
      items: { browserSync: false, agents: false, computer: false },
      sync: { mode: null, sites: [], readable: true },
    });
    // Agree with no site yet: synced, but nothing to list and the step is not done.
    const ta = await browser(a);
    const agreed = siteBundle([], []);
    expect((await request('POST', '/captures', { token: ta, body: { capture: agreed } })).status).toBe(200);
    expect((await setup(a)).items.browserSync).toBe(false);
    expect((await db.select().from(schema.setups)).filter(row => row.browserSyncedAt)).toHaveLength(0);
    // A site with no cookies yet: the cookie digest is unchanged, and the site still shows.
    const added = siteBundle([], ['github.com', 'notion.so']);
    expect(await (await request('POST', '/captures', { token: ta, body: { capture: added } })).json()).toMatchObject({
      status: 'unchanged',
    });
    expect(await setup(a)).toMatchObject({
      items: { browserSync: true },
      sync: { mode: 'sites', sites: ['github.com', 'notion.so'], readable: true },
    });
    expect((await db.select().from(schema.setups))[0]).toMatchObject({
      membershipId: (await member('a')).membershipId,
      browserSyncedAt: expect.any(Date),
    });
    expect((await setup(b)).items.browserSync).toBe(false);
    // The notice opens once set up, and closing it is per user and idempotent.
    for (const id of ['a', 'b']) await recordSetupStep(db, await member(id), 'setUp');
    expect(await setup(a)).toMatchObject({ noticeOpen: true, setUpAt: expect.any(String), items: { computer: true } });
    for (const _ of [1, 2]) {
      const closed = await request('POST', '/setup/notice/close', { cookie: a });
      expect(closed.status).toBe(200);
      expect(await closed.json()).toEqual({ closed: true });
    }
    expect((await setup(a)).noticeOpen).toBe(false);
    expect((await setup(b)).noticeOpen).toBe(true);
  });
  it('keep uploads answering when setup progress cannot be written', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = client();
    const a = await browser(await identity('a'));
    await pg.exec('DROP TABLE setups');
    const res = await request('POST', '/captures', {
      token: a,
      body: { capture: siteBundle([], ['github.com']) },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('stored');
    expect(errors.mock.calls.flat().join('\n')).toContain('setup browserSynced failed');
  });

  it('Delete everything resets set-up even when the provider fails, and keeps setup history', async () => {
    const a = await identity('a');
    const b = await identity('b');
    for (const id of ['a', 'b']) {
      await recordSetupStep(db, await member(id), 'browserSynced');
      await recordSetupStep(db, await member(id), 'setUp');
    }
    expect((await client()('DELETE', '/computer', { cookie: a })).status).toBe(200);
    expect(await (await client()('GET', '/setup', { cookie: a })).json()).toMatchObject({
      setUpAt: null,
      noticeOpen: false,
    });
    const [row] = await db
      .select()
      .from(schema.setups)
      .where(eq(schema.setups.membershipId, (await member('a')).membershipId));
    expect(row).toMatchObject({ setUpAt: null, browserSyncedAt: expect.any(Date), firstSetUpAt: expect.any(Date) });
    // A provider failure answers 503 after set-up is already reset.
    const request = client();
    await openComputerSession(
      db,
      { provider: fake.provider, metering: noMetering },
      { ...(await member('b')), clientId: 'agent-client' },
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = client({
      ...fake.provider,
      kill: async () => {
        throw new Error('provider down');
      },
    });
    expect((await failing('DELETE', '/computer', { cookie: b })).status).toBe(503);
    expect((await (await request('GET', '/setup', { cookie: b })).json()).setUpAt).toBeNull();
  });

  it('Delete all computers deletes only the computers, keeping synced data, setup, and other users', async () => {
    const request = client();
    const a = await identity('a');
    const b = await identity('b');
    expect(await (await request('DELETE', '/computer/computers', { cookie: a })).json()).toEqual({ deleted: 0 });
    for (const user of [a, b])
      expect(
        (await request('POST', '/captures', { token: await browser(user), body: { capture: bundle([cookie()]) } }))
          .status,
      ).toBe(200);
    for (const userId of ['a', 'b']) {
      await recordSetupStep(db, await member(userId), 'setUp');
      await openAs(userId);
    }
    const deleted = await request('DELETE', '/computer/computers', { cookie: a });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: 1 });
    expect(fake.calls.kill).toBe(1);
    // The agent's session goes with it.
    expect(await db.select().from(schema.computerSessions)).toHaveLength(1);
    expect(await (await request('GET', '/computer', { cookie: a })).json()).toMatchObject({
      capture: { cookieCount: 1 },
      computers: [],
    });
    expect((await (await request('GET', '/setup', { cookie: a })).json()).setUpAt).toEqual(expect.any(String));
    expect((await (await request('GET', '/computer', { cookie: b })).json()).computers).toHaveLength(1);
    const created = fake.calls.create;
    expect(await openAs('a')).toHaveProperty('sessionId');
    expect(fake.calls.create).toBe(created + 1);
    // A provider failure keeps the computer recorded, so a retry kills it.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = client({
      ...fake.provider,
      kill: async () => {
        throw new Error('provider down');
      },
    });
    expect((await failing('DELETE', '/computer/computers', { cookie: b })).status).toBe(503);
    expect((await (await request('GET', '/computer', { cookie: b })).json()).computers).toHaveLength(1);
  });

  it('New computer makes a paused computer with no agent, confirming what it replaces at the limit', async () => {
    const limited = new Map<string, number>();
    const request = client(fake.provider, {
      hooks: {
        metering: noMetering,
        operatorAdmin: noOperatorAdmin,
        limits: { ...noLimits, computers: async (_, id) => limited.get(id) ?? null },
      },
    });
    const a = await identity('a');
    await identity('b');
    limited.set((await member('a')).organizationId, 1);
    const view = async () => (await request('GET', '/computer', { cookie: a })).json();
    const make = (body?: unknown) => request('POST', '/computer/computers', { cookie: a, body: body ?? {} });
    for (const body of [{ replace: 'nope' }, { extra: true }])
      expect((await make(body)).status, JSON.stringify(body)).toBe(400);
    expect(await view()).toMatchObject({ computers: [], limit: 1, replaces: null });
    const made = await make();
    expect(made.status).toBe(201);
    const { computerId: first } = await made.json();
    expect(first).toMatch(/^cmp_/);
    expect(await view()).toMatchObject({
      computers: [{ computerId: first, status: 'paused', agent: null, label: null }],
      limit: 1,
      replaces: { computerId: first },
    });
    expect(await db.select().from(schema.computerSessions)).toEqual([]);
    // At the limit the page must name the computer it replaces.
    const unconfirmed = await make();
    expect(unconfirmed.status).toBe(409);
    expect(await unconfirmed.json()).toMatchObject({ error: 'confirm_replace' });
    expect(fake.calls.kill).toBe(0);
    const second = await make({ replace: first });
    expect(second.status).toBe(201);
    expect(fake.calls.kill).toBe(1);
    const { computerId: replacing } = await second.json();
    expect((await view()).computers.map((row: { computerId: string }) => row.computerId)).toEqual([replacing]);
    // With every computer in use, there is nothing to replace.
    await request('POST', '/computer/takeover', { cookie: a, body: { lease: randomUUID(), computer: replacing } });
    expect((await view()).replaces).toBeNull();
    expect((await make({ replace: replacing })).status).toBe(409);
    expect(fake.calls.kill).toBe(1);
  });

  it("deletes one of the member's computers from the page, refusing a computer in use or another member's", async () => {
    const request = client();
    const a = await identity('a');
    const b = await identity('b');
    const opened = await openAs('a');
    if ('error' in opened) throw new Error(opened.error);
    const del = (cookie: string, id: string) => request('DELETE', `/computer/computers/${id}`, { cookie });
    // A malformed ID, someone else's, or none of that ID.
    expect((await del(a, 'nope')).status).toBe(404);
    expect((await del(b, opened.computer.id)).status).toBe(404);
    expect((await del(a, newPublicId('computer'))).status).toBe(404);
    // An agent is using it.
    const busy = await del(a, opened.computer.id);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: 'busy', busyUntil: expect.any(String) });
    await db.update(schema.computerSessions).set({ lastCallAt: new Date(Date.now() - 61_000) });
    const deleted = await del(a, opened.computer.id);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
    expect(fake.calls.kill).toBe(1);
    expect((await (await request('GET', '/computer', { cookie: a })).json()).computers).toEqual([]);
  });

  it('Computer size sets what new computers are made at, for the caller only, and resets nothing', async () => {
    const request = client();
    const a = await identity('a');
    const b = await identity('b');
    for (const body of [null, {}, { size: '3x' }, { size: '2x', member: 'other' }])
      expect((await request('PUT', '/computer/size', { cookie: a, body })).status).toBe(400);
    const chosen = await request('PUT', '/computer/size', { cookie: a, body: { size: '2x' } });
    expect(chosen.status).toBe(200);
    expect(await chosen.json()).toEqual({ size: '2x' });
    await openAs('a');
    await openAs('b');
    expect(fake.calls.sizes).toEqual(['2x', '1x']);
    expect(await (await request('GET', '/computer', { cookie: a })).json()).toMatchObject({ size: '2x' });
    expect(await (await request('GET', '/computer', { cookie: b })).json()).toMatchObject({ size: '1x' });
    // Choosing another size never touches a computer.
    await request('PUT', '/computer/size', { cookie: a, body: { size: '1x' } });
    expect(fake.calls.kill).toBe(0);
    expect((await (await request('GET', '/computer', { cookie: a })).json()).computers).toHaveLength(1);
    await openAs('a');
    expect(fake.calls.sizes).toEqual(['2x', '1x', '1x']);
  });

  it('Screen size sets what new computers start at, for the caller only, and resets nothing', async () => {
    const request = client();
    const a = await identity('a');
    const b = await identity('b');
    const choose = async (screen: unknown, cookie = a) =>
      (await request('PUT', '/computer/screen', { cookie, body: { screen } })).json();
    for (const body of [null, {}, { screen: '1024x768' }, { screen: '1440x900', member: 'other' }])
      expect((await request('PUT', '/computer/screen', { cookie: a, body })).status).toBe(400);
    expect(await choose('1280x1024')).toEqual({ screen: '1280x1024' });
    const screenOf = async (opened: Awaited<ReturnType<typeof openAs>>) => {
      if ('error' in opened) throw new Error(opened.error);
      const [row] = await db
        .select({ sandboxId: schema.computers.sandboxId })
        .from(schema.computers)
        .where(eq(schema.computers.publicId, opened.computer.id));
      return fake.sandboxes.get(row!.sandboxId!)!.screen;
    };
    const mine = await openAs('a');
    expect(await screenOf(mine)).toEqual({ width: 1280, height: 1024 });
    // Another member's start at the default.
    expect(await screenOf(await openAs('b'))).toEqual({ width: 1440, height: 900 });
    expect(await (await request('GET', '/computer', { cookie: a })).json()).toMatchObject({ screen: '1280x1024' });
    expect(await (await request('GET', '/computer', { cookie: b })).json()).toMatchObject({ screen: '1440x900' });
    // Changing it leaves existing computers alone, and later ones get it.
    const screens = fake.calls.screens.length;
    await choose('1920x1200');
    expect(fake.calls.screens).toHaveLength(screens);
    expect(await screenOf(mine)).toEqual({ width: 1280, height: 1024 });
    expect(await screenOf(await openAs('a'))).toEqual({ width: 1920, height: 1200 });
  });

  it('report each computer as in use only while an agent holds it', async () => {
    const a = await identity('a');
    const request = client();
    const shown = async () => (await (await request('GET', '/computer', { cookie: a })).json()).computers;
    expect(await shown()).toEqual([]);
    await openAs('a');
    expect(await shown()).toMatchObject([{ status: 'in_use', agent: { host: 'agent-client' } }]);
    await db.update(schema.computerSessions).set({ lastCallAt: new Date(Date.now() - 61_000) });
    expect((await shown())[0].status).not.toBe('in_use');
  });

  it("keep each page load's live view watch through the heartbeat, per user, and validate what it reports", async () => {
    const request = client();
    const a = await identity('a');
    const b = await identity('b');
    const page = randomUUID();
    const beat = async (user: string, leases: unknown) => {
      const response = await request('POST', '/heartbeat', { cookie: user, body: { leases } });
      return { status: response.status, json: await response.json() };
    };
    const computer = await newComputer('a');
    const lease = (state: string, id: string = page) => ({ kind: 'live-view', id, state, computer });
    for (const leases of [
      [],
      [{ ...lease('visible'), kind: 'other' }],
      [lease('visible', 'not-a-uuid')],
      [lease('focused')],
      [{ ...lease('visible'), extra: true }],
      [{ kind: 'live-view', id: page, state: 'visible' }],
      Array.from({ length: 9 }, () => lease('visible', randomUUID())),
    ])
      expect((await beat(a, leases)).status, JSON.stringify(leases).slice(0, 80)).toBe(400);
    expect((await request('POST', '/heartbeat', { cookie: a, body: 'not json' })).status).toBe(400);
    // Watching wakes it.
    expect(await beat(a, [lease('visible')])).toEqual({
      status: 200,
      json: {
        leases: [
          {
            kind: 'live-view',
            id: page,
            status: { computer: 'running', watching: true, takeover: null, agentWaiting: null },
          },
        ],
      },
    });
    expect(fake.calls.create).toBe(1);
    await openComputerSession(
      db,
      { provider: fake.provider, metering: noMetering },
      { ...(await member('a')), clientId: 'agent-client' },
    );
    expect((await beat(a, [lease('visible')])).json.leases[0].status).toMatchObject({
      computer: 'running',
      watching: true,
    });
    // Another user's heartbeat on the same lease ID and computer finds nothing of theirs.
    expect((await beat(b, [lease('released')])).json.leases[0].status).toMatchObject({
      computer: 'none',
      watching: false,
    });
    expect((await beat(a, [lease('hidden')])).json.leases[0].status.watching).toBe(true);
    expect((await beat(a, [lease('released')])).json.leases[0].status.watching).toBe(false);
  });

  it('take control for one page load and hand back, per user, refusing while metering refuses', async () => {
    let refusal: MeteringRefusal | null = null;
    const metering = { ...noMetering, refusal: async () => refusal };
    const request = client(fake.provider, { hooks: { metering, operatorAdmin: noOperatorAdmin } });
    const a = await identity('a');
    const b = await identity('b');
    const page = randomUUID();
    const computer = await newComputer('a');
    const call = async (user: string, path: string, body: unknown) => {
      const response = await request('POST', path, { cookie: user, body });
      return { status: response.status, json: await response.json() };
    };
    for (const path of ['/computer/takeover', '/computer/hand-back'])
      for (const body of [
        {},
        { lease: page },
        { lease: 'not-a-uuid', computer },
        { lease: page, computer, extra: true },
        'not json',
      ])
        expect((await call(a, path, body)).status, `${path} ${JSON.stringify(body)}`).toBe(400);
    // With no agent working, a takeover wakes the computer.
    const taken = await call(a, '/computer/takeover', { lease: page, computer });
    expect(taken).toMatchObject({
      status: 200,
      json: { computer: 'running', watching: true, takeover: { mine: true, since: expect.any(String) } },
    });
    expect(fake.calls.create).toBe(1);
    // Another user can neither hand back nor see it.
    expect((await call(b, '/computer/hand-back', { lease: page, computer })).json).toMatchObject({
      computer: 'none',
      takeover: null,
    });
    // A second page load of the same user moves the takeover to itself.
    const other = randomUUID();
    expect((await call(a, '/computer/takeover', { lease: other, computer })).json.takeover).toEqual({
      mine: true,
      since: taken.json.takeover.since,
    });
    expect((await call(a, '/computer/hand-back', { lease: page, computer })).json.takeover).toEqual({
      mine: false,
      since: taken.json.takeover.since,
    });
    const handed = await call(a, '/computer/hand-back', { lease: other, computer });
    expect(handed).toMatchObject({ status: 200, json: { takeover: null, watching: true } });
    expect((await call(a, '/computer/hand-back', { lease: other, computer })).status).toBe(200);
    // A metering refusal (a used-up allowance) refuses the takeover with when it lifts.
    refusal = { message: 'Used up.', resetsAt: new Date('2026-11-01T00:00:00Z') };
    expect(await call(a, '/computer/takeover', { lease: page, computer })).toEqual({
      status: 403,
      json: { error: 'credit_exhausted', message: 'Used up.', resetsAt: '2026-11-01T00:00:00.000Z' },
    });
  });

  it("set the computer's clipboard only for the page load in control, per user, refusing oversized text", async () => {
    const request = client();
    const a = await identity('a');
    const b = await identity('b');
    const page = randomUUID();
    const computer = await newComputer('a');
    const paste = async (user: string, body: unknown) => {
      const response = await request('POST', '/computer/clipboard', { cookie: user, body });
      return { status: response.status, json: await response.json() };
    };
    for (const body of [
      {},
      { lease: page, computer },
      { lease: page, text: 'x' },
      { lease: 'not-a-uuid', computer, text: 'x' },
      { lease: page, computer, text: 1 },
      { lease: page, computer, text: 'x', extra: true },
      'not json',
    ])
      expect((await paste(a, body)).status, JSON.stringify(body)).toBe(400);
    // No takeover yet.
    expect(await paste(a, { lease: page, computer, text: 'x' })).toEqual({
      status: 409,
      json: { error: 'not_in_control' },
    });
    await request('POST', '/computer/takeover', { cookie: a, body: { lease: page, computer } });
    const text = 'café “quoted” 日本語 🎉';
    expect(await paste(a, { lease: page, computer, text })).toEqual({ status: 200, json: {} });
    const sandbox = () => [...fake.sandboxes.values()][0]!;
    expect(sandbox().clipboard).toBe(text);
    // Another page load of the same user only watches; another user has no takeover, whatever lease they send.
    expect((await paste(a, { lease: randomUUID(), computer, text: 'other page' })).status).toBe(409);
    expect((await paste(b, { lease: page, computer, text: 'other user' })).status).toBe(409);
    expect(sandbox().clipboard).toBe(text);
    // 1 MiB of UTF-8: two-byte characters count twice. A body past the upload limit is refused before it is read.
    expect((await paste(a, { lease: page, computer, text: 'é'.repeat(512 * 1024) })).status).toBe(200);
    expect(await paste(a, { lease: page, computer, text: `${'é'.repeat(512 * 1024)}x` })).toEqual({
      status: 413,
      json: { error: 'too_large' },
    });
    expect(await paste(a, { lease: page, computer, text: 'x'.repeat(4_000_001) })).toEqual({
      status: 413,
      json: { error: 'too_large' },
    });
    expect(sandbox().clipboard).toHaveLength(512 * 1024);
    // A computer that cannot take it is a 503; after the hand-back, the page is no longer in control.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.failClipboard();
    expect(await paste(a, { lease: page, computer, text })).toEqual({
      status: 503,
      json: { error: 'service_unavailable' },
    });
    fake.failClipboard(false);
    await request('POST', '/computer/hand-back', { cookie: a, body: { lease: page, computer } });
    expect((await paste(a, { lease: page, computer, text })).status).toBe(409);
  });

  it("paste a PNG at the API's origin by ticket, only from the web app's pages, for the page load in control", async () => {
    const apiOrigin = 'http://localhost:3197';
    const request = client(fake.provider, { apiOrigin });
    const api = createApi({ db, auth, origin, apiOrigin, computers: fake.provider });
    const a = await identity('a');
    const b = await identity('b');
    const page = randomUUID();
    const computer = await newComputer('a');
    // The ticket comes from the web app's own origin, with the session, like any change.
    const ticket = async (user: string, lease = page) => {
      const response = await request('POST', '/computer/clipboard/ticket', { cookie: user, body: { lease, computer } });
      expect(response.status).toBe(200);
      return ((await response.json()) as { url: string }).url;
    };
    const url = await ticket(a);
    expect(url).toMatch(/^http:\/\/localhost:3197\/api\/v1\/computer\/clipboard\/image\?ticket=[\w-]+\.[\w-]+$/);
    for (const body of [
      {},
      { lease: page },
      { lease: 'not-a-uuid', computer },
      { lease: page, computer: 'cmp_x' },
      { lease: page, computer, extra: 1 },
    ])
      expect((await request('POST', '/computer/clipboard/ticket', { cookie: a, body })).status).toBe(400);
    // A PNG's signature and header, then its bytes.
    const png = (size: number) => {
      const bytes = new Uint8Array(size).fill(7);
      bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]);
      return bytes;
    };
    // The page's upload: no cookie reaches the API's origin, so the ticket alone says who sends it.
    const send = async (
      to: string,
      body: Uint8Array<ArrayBuffer> | string = png(64),
      { from = origin, type = 'image/png' }: { from?: string | null; type?: string } = {},
    ) => {
      const response = await api.request(to, {
        method: 'POST',
        headers: { ...(from ? { origin: from } : {}), 'content-type': type },
        body,
      });
      return {
        status: response.status,
        json: await response.json(),
        cors: response.headers.get('access-control-allow-origin'),
      };
    };
    // A preflight answers only the web app's origin.
    const preflight = (from: string) =>
      api.request(url, {
        method: 'OPTIONS',
        headers: {
          origin: from,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });
    const allowed = await preflight(origin);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(origin);
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull();
    expect((await preflight('https://evil.test')).headers.get('access-control-allow-origin')).toBeNull();
    // No takeover yet.
    expect(await send(url)).toEqual({ status: 409, json: { error: 'not_in_control' }, cors: origin });
    await request('POST', '/computer/takeover', { cookie: a, body: { lease: page, computer } });
    const image = png(4096);
    expect(await send(url, image)).toEqual({ status: 200, json: {}, cors: origin });
    const sandbox = () => [...fake.sandboxes.values()][0]!;
    expect(sandbox().clipboard).toEqual({ png: image });
    // Refused: no ticket, an altered one, the relay's, one from another page load or user, from another origin, and
    // anything but a PNG.
    const ticketOf = (to: string) => new URL(to).searchParams.get('ticket')!;
    const relay = await request('POST', '/live-view/ticket', { cookie: a, body: { lease: page, computer } });
    const relayTicket = ticketOf(((await relay.json()) as { url: string }).url.replace(/^ws/, 'http'));
    const at = (value: string) => `${apiOrigin}/api/v1/computer/clipboard/image?ticket=${value}`;
    expect((await send(at(''))).status).toBe(401);
    expect((await send(`${apiOrigin}/api/v1/computer/clipboard/image`)).status).toBe(401);
    expect((await send(at(`${ticketOf(url)}x`))).status).toBe(401);
    expect((await send(at(relayTicket))).status).toBe(401);
    expect((await send(await ticket(a, randomUUID()))).status).toBe(409);
    expect((await send(await ticket(b))).status).toBe(409);
    expect(await send(url, png(64), { from: 'https://evil.test' })).toMatchObject({
      status: 403,
      json: { error: 'forbidden_origin' },
    });
    expect((await send(url, png(64), { from: null })).status).toBe(403);
    expect((await send(url, png(64), { type: 'image/jpeg' })).status).toBe(400);
    expect((await send(url, 'GIF89a, not a PNG')).status).toBe(400);
    expect(await send(url, png(MAX_CLIPBOARD_IMAGE_BYTES + 1))).toMatchObject({
      status: 413,
      json: { error: 'too_large' },
    });
    expect(sandbox().clipboard).toEqual({ png: image });
    // A computer that cannot take it is a 503.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.failClipboard();
    expect((await send(url)).status).toBe(503);
    fake.failClipboard(false);
    // A ticket lapses, and stops working once its session ends.
    vi.useFakeTimers({ now: Date.now() + LIVE_VIEW_TICKET_MS + 1000, toFake: ['Date'] });
    try {
      expect((await send(url)).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
    const fresh = await ticket(a);
    await db.delete(schema.session).where(eq(schema.session.userId, 'a'));
    expect((await send(fresh)).status).toBe(401);
  });

  it("list the member's computers, and watch, take over, paste on, and hand back one by its ID", async () => {
    const request = client();
    const a = await identity('a');
    const b = await identity('b');
    const page = randomUUID();
    const computers = { provider: fake.provider, metering: noMetering };
    const agent = { ...(await member('a')), clientId: 'agent-client' };
    const opened = await openComputerSession(db, computers, agent, { label: 'Book a table' });
    if ('error' in opened) throw new Error(opened.error);
    const computer = opened.computer.id;
    const other = await openComputerSession(db, computers, { ...(await member('b')), clientId: 'agent-client' });
    if ('error' in other) throw new Error(other.error);
    const post = async (user: string, path: string, body: unknown) => {
      const response = await request('POST', path, { cookie: user, body });
      return { status: response.status, json: await response.json() };
    };
    // The page lists the computer with the agent using it, and only the user's own.
    expect((await (await request('GET', '/computer', { cookie: a })).json()).computers).toEqual([
      {
        computerId: computer,
        label: 'Book a table',
        createdAt: expect.any(String),
        lastUsedAt: expect.any(String),
        status: 'in_use',
        agent: { agent: null, host: 'agent-client' },
      },
    ]);
    // A malformed ID is refused; another member's computer does not exist for this user.
    for (const malformed of ['cmp_x', `${computer}x`]) {
      expect((await post(a, '/computer/takeover', { lease: page, computer: malformed })).status).toBe(400);
      expect((await post(a, '/computer/clipboard', { lease: page, computer: malformed, text: 'x' })).status).toBe(400);
      expect(
        (
          await post(a, '/heartbeat', {
            leases: [{ kind: 'live-view', id: page, state: 'visible', computer: malformed }],
          })
        ).status,
      ).toBe(400);
    }
    expect(await post(a, '/computer/takeover', { lease: page, computer: other.computer.id })).toMatchObject({
      status: 404,
      json: { error: 'computer_not_found' },
    });
    const beat = await post(a, '/heartbeat', {
      leases: [{ kind: 'live-view', id: page, state: 'visible', computer: other.computer.id }],
    });
    expect(beat.json.leases[0].status).toMatchObject({ computer: 'none', watching: false });
    // Watching the computer, then taking it over: the agent's calls wait, and the page shows it waiting.
    expect(
      (await post(a, '/heartbeat', { leases: [{ kind: 'live-view', id: page, state: 'visible', computer }] })).json
        .leases[0].status,
    ).toMatchObject({ computer: 'running', watching: true });
    await opened.done();
    expect(await post(a, '/computer/takeover', { lease: page, computer })).toMatchObject({
      status: 200,
      json: { takeover: { mine: true } },
    });
    expect(await useComputerSession(db, computers, agent, opened.sessionId)).toMatchObject({
      error: 'user_in_control',
    });
    // Another user cannot hand it back.
    expect((await post(b, '/computer/hand-back', { lease: page, computer })).json).toMatchObject({
      computer: 'none',
    });
    expect(await post(a, '/computer/clipboard', { lease: page, computer, text: 'on the computer' })).toEqual({
      status: 200,
      json: {},
    });
    const [row] = await db
      .select({ sandboxId: schema.computers.sandboxId })
      .from(schema.computers)
      .where(eq(schema.computers.publicId, computer));
    expect(fake.sandboxes.get(row!.sandboxId!)?.clipboard).toBe('on the computer');
    // Handing back resumes the agent's session.
    expect((await post(a, '/computer/hand-back', { lease: page, computer })).json.takeover).toBeNull();
    expect(await useComputerSession(db, computers, agent, opened.sessionId)).toMatchObject({
      sessionId: opened.sessionId,
      userHadControl: true,
    });
  });

  it('answer a takeover with starting while another request creates the computer, and 503 when it is unreachable', async () => {
    const a = await identity('a');
    const b = await identity('b');
    const page = randomUUID();
    const creating = newPublicId('computer');
    await db.insert(schema.computers).values({
      membershipId: (await member('a')).membershipId,
      publicId: creating,
      lastUsedAt: new Date(),
    });
    const starting = await client()('POST', '/computer/takeover', {
      cookie: a,
      body: { lease: page, computer: creating },
    });
    expect(starting.status).toBe(409);
    expect(await starting.json()).toMatchObject({ error: 'starting' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const unreachable = client({
      ...fake.provider,
      connect: async () => {
        throw new Error('provider down');
      },
    });
    const computer = await newComputer('b');
    expect(
      (await unreachable('POST', '/computer/takeover', { cookie: b, body: { lease: page, computer } })).status,
    ).toBe(503);
    // The takeover is given back rather than held on a computer nobody can use.
    const status = await (
      await client()('POST', '/computer/hand-back', { cookie: b, body: { lease: page, computer } })
    ).json();
    expect(status.takeover).toBeNull();
  });

  it('turn unexpected failures into a generic 503 and log only the error class', async () => {
    const a = await identity('a');
    await openComputerSession(
      db,
      { provider: fake.provider, metering: noMetering },
      { ...(await member('a')), clientId: 'agent-client' },
    );
    const failing: ComputerProvider = {
      ...fake.provider,
      kill: async () => {
        throw new Error('postgres://user:secret@db/sandbox-token');
      },
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await client(failing)('DELETE', '/computer', { cookie: a });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'service_unavailable' });
    expect(logged).toHaveBeenCalled();
    expect(logged.mock.calls.flat().join(' ')).not.toContain('secret');
  });
  it("show and change only the current membership's sync data and setup, and a browser's own membership's", async () => {
    const request = client();
    const a = await identity('a');
    await identity('b');
    // A second, newer membership in another organization: not the one the web app acts in.
    const owner = { id: 'b', name: 'b', email: 'b@example.test' };
    const team = await membership(
      db,
      'a',
      (await db.transaction(tx => createOrganization(tx, { name: 'Team', owner })))!,
    );
    await saveFromBrowser(db, team, siteBundle([cookie({ domain: 'notion.so' })], ['notion.so']));
    await adoptSyncSettings(db, team, { sites: ['notion.so'], excludedDomains: [], paused: true }, '127.0.0.1');
    await recordSetupStep(db, team, 'setUp');
    expect(await (await request('GET', '/sync', { cookie: a })).json()).toMatchObject({
      settings: null,
      disconnected: false,
    });
    expect(await (await request('GET', '/setup', { cookie: a })).json()).toMatchObject({
      items: { browserSync: false, computer: false },
    });
    // The extension's upload lands in its browser's membership, the current one when it connected.
    const capture = siteBundle([cookie({ domain: 'github.com' })], ['github.com']);
    expect((await request('POST', '/captures', { token: await browser(a), body: { capture } })).status).toBe(200);
    expect(await (await request('GET', '/setup', { cookie: a })).json()).toMatchObject({
      items: { browserSync: true },
      sync: { mode: 'sites', sites: ['github.com'] },
    });
    // Delete everything leaves the other membership's capture, settings, and setup.
    expect((await request('DELETE', '/computer', { cookie: a })).status).toBe(200);
    expect(await captureView(db, team)).toMatchObject({ cookieCount: 1 });
    expect((await syncView(db, team)).settings).toMatchObject({ sites: ['notion.so'] });
    expect((await setupView(db, team)).items.computer).toBe(true);
  });
});

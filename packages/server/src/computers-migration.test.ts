import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Database } from './database.ts';
import { databaseSchema } from './database-schema.ts';
import { newPublicId } from './ids.ts';
import { person } from './member-fixtures.ts';

// Computers with no fork_of are now ordinary: any number per member. The columns from before stay until a later
// release, so the old code still serving during a deploy has to keep working, on the database this migration leaves.
let pg: PGlite;
let db: Database;
beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema: databaseSchema }) as unknown as Database;
  await migrate(drizzle(pg), { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
});
afterAll(() => pg.close());

const insert = async (membershipId: number, forkOf: number | null, lastUsedAt: Date | null) => {
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO computers (public_id, membership_id, fork_of, status, last_used_at)
     VALUES ($1, $2, $3, 'ready', $4) ON CONFLICT DO NOTHING RETURNING id`,
    [newPublicId('computer'), membershipId, forkOf, lastUsedAt],
  );
  return rows[0] ? Number(rows[0].id) : null;
};

it('allows any number of computers per member, and stops one main-computer row being inserted twice by old code', async () => {
  const a = await person(db, 'a');
  const used = new Date();
  // New rows always set last_used_at; two of them with no fork_of no longer conflict.
  expect(await insert(a.membershipId, null, used)).not.toBeNull();
  expect(await insert(a.membershipId, null, used)).not.toBeNull();
  // The old code's insert of a main computer (no last_used_at) still conflicts with itself, not with new rows.
  expect(await insert(a.membershipId, null, null)).not.toBeNull();
  expect(await insert(a.membershipId, null, null)).toBeNull();
  const { rows } = await pg.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'computers' AND indexname LIKE 'computers_%main%'",
  );
  expect(rows.map(row => row.indexname)).toEqual(['computers_legacy_main_unique']);
});

it('keeps what were forks when what was their main computer is deleted', async () => {
  const b = await person(db, 'b');
  const main = await insert(b.membershipId, null, null);
  const fork = await insert(b.membershipId, main, new Date());
  await pg.query('DELETE FROM computers WHERE id = $1', [main]);
  const { rows } = await pg.query<{ id: string }>('SELECT id FROM computers WHERE id = $1', [fork]);
  expect(rows.map(row => Number(row.id))).toEqual([fork]);
});

import 'server-only';
import { timeZonePattern } from '@clutchbox/capture/environment';
import { sql } from 'drizzle-orm';
import type { Database } from './database.ts';
import { userSettings } from './schema.ts';

// An IANA zone name, like America/Los_Angeles, UTC, or Etc/GMT+5. It becomes a path on the computer, so the
// pattern (the same as the columns' CHECK) admits no dots or spaces; Intl rejects names that are not zones.
export function isTimeZone(value: string) {
  if (!timeZonePattern.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// The account page reports its browser's time zone on every visit: the zone a computer takes when its session's
// profile has none of its own (computers.ts, applyTimeZone). Writes only when it changed.
export async function setTimeZone(db: Database, userId: string, timeZone: string) {
  await db
    .insert(userSettings)
    .values({ userId, timeZone })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { timeZone },
      setWhere: sql`${userSettings.timeZone} IS DISTINCT FROM ${timeZone}`,
    });
  return { timeZone };
}

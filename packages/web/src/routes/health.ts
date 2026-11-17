import { assertDatabaseEnvironment } from '@clutchbox/server/database';
import { type GetServices, unavailable } from '../services.ts';

// /api/health: the server and its database. A query on every call keeps a database that scales to zero awake, so
// frequent checks (a host's health check every few seconds) belong on /api/live.
export const healthRoute = (getServices: GetServices) =>
  async function GET() {
    try {
      // Checks the database on every call; getServices only checks once per instance.
      const { db, config } = await getServices();
      await assertDatabaseEnvironment(db, config.APP_ENV);
      return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return unavailable('health', error);
    }
  };

// /api/live: the server answers, without touching the database or building services.
export const liveRoute = (_getServices: GetServices) =>
  function GET() {
    return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  };

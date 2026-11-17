import { type GetServices, unavailable } from '../services.ts';

// /api/health: this instance is ready, its database reachable, migrated, and of its environment's data class.
// getServices checks that on an instance's first request and again after each failure, so the database is queried
// only until the check passes: a host checking every few seconds still lets a database that scales to zero sleep.
export const healthRoute = (getServices: GetServices) =>
  async function GET() {
    try {
      await getServices();
      return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return unavailable('health', error);
    }
  };

import { BoatApi, type CommandResponse, Configuration, ResponseError, waitUntilReady } from '@boatdev/sdk';
import { HELPER_DIR, STOP_CHROME } from '@clutchbox/e2b';
import { CLEAR_CHROME_LOCKS, SNAPSHOT } from './index.ts';
import { runSetup } from './setup.ts';
import { READY_MS } from './timing.ts';

// Builds the snapshot on the Boat account of BOAT_API_KEY under `name`: a default sandbox runs SETUP, Chrome starts
// once (so a new computer's first start skips the profile's creation), and the sandbox is saved, then deleted.
export async function buildComputerSnapshot(
  name = process.env.BOAT_COMPUTER_SNAPSHOT || SNAPSHOT,
  { apiKey = process.env.BOAT_API_KEY, log = console.log }: { apiKey?: string; log?: (line: string) => void } = {},
) {
  if (!apiKey) throw new Error('BOAT_API_KEY is required.');
  const boat = new BoatApi(new Configuration({ basePath: 'https://boat.dev/api/v1', accessToken: apiKey }));
  const { sandbox } = await boat.create({ ttlSeconds: 3600, noEnv: true, monitoring: false, name: `build-${name}` });
  log(`builder ${sandbox.id}`);
  try {
    await waitUntilReady(boat, sandbox.id, { timeoutMs: READY_MS });
    log(await runSetup(boat, sandbox.id));
    const chrome = (await boat.command({
      sandboxId: sandbox.id,
      command: `export DISPLAY=:0; ${HELPER_DIR}/ensure-chrome.sh && sleep 3; set -- chrome 10\n${STOP_CHROME}\n${CLEAR_CHROME_LOCKS}`,
      timeoutSeconds: 120,
    })) as CommandResponse;
    if (chrome.exitCode !== 0) throw new Error(`Chrome's first start exited ${chrome.exitCode}`);
    let saved = (
      await boat.saveSavedSnapshot({ sandboxId: sandbox.id, name }).catch(async error => {
        const body = error instanceof ResponseError ? await error.response.text() : '';
        throw new Error(`saving the snapshot failed: ${body.slice(0, 500)}`, { cause: error });
      })
    ).snapshot;
    const end = Date.now() + 20 * 60_000;
    while (saved.status === 'saving' && Date.now() < end) {
      await new Promise(resolve => setTimeout(resolve, 5_000));
      saved = (await boat.getSavedSnapshot({ name })).snapshot;
    }
    if (saved.status !== 'ready') throw new Error(`snapshot ${saved.status}: ${saved.error ?? ''}`);
    log(`snapshot ${name} ready (${saved.snapshotId})`);
    return saved;
  } finally {
    await boat.deleteSandbox({ sandboxId: sandbox.id, xAsciiConfirmDelete: sandbox.id }).catch(() => {});
  }
}

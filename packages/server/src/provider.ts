import 'server-only';
import { boatComputerProvider, SNAPSHOT } from '@clutchbox/boat';
import type { ComputerProvider } from '@clutchbox/computer';
import { e2bComputerProvider, TEMPLATE } from '@clutchbox/e2b';
import type { ServerConfig } from './config.ts';
import { fakeComputerProvider } from './fake-computer-provider.ts';

// The deployment's computers when no provider account hook supplies them: Boat on BOAT_API_KEY's account, from
// BOAT_COMPUTER_SNAPSHOT or our snapshot's name, or else E2B on E2B_API_KEY's team (the E2B SDK reads the key from the
// same environment), from E2B_COMPUTER_TEMPLATE or the default template. Without a key, development uses the in-memory
// fake (one process only), and production cannot run. Computers can't move between providers, so changing a
// deployment's provider needs its computers deleted.
export function providerFromConfig(config: ServerConfig): ComputerProvider {
  if (config.BOAT_API_KEY)
    return boatComputerProvider({ apiKey: config.BOAT_API_KEY, snapshot: config.BOAT_COMPUTER_SNAPSHOT ?? SNAPSHOT });
  if (config.E2B_API_KEY) return e2bComputerProvider(config.E2B_COMPUTER_TEMPLATE ?? TEMPLATE);
  if (config.APP_ENV === 'production') throw new Error('E2B_API_KEY or BOAT_API_KEY is required.');
  return fakeComputerProvider().provider;
}

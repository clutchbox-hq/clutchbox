// Builds the snapshot Boat computers start from, on your Boat account. Requires BOAT_API_KEY; set BOAT_COMPUTER_SNAPSHOT
// to name it. Usage: bun run --cwd packages/boat build-template
import { buildComputerSnapshot } from '../src/template.ts';

console.log(JSON.stringify(await buildComputerSnapshot()));

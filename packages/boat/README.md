# Boat computers

Clutchbox computers on [Boat](https://boat.dev): the server picks this provider when `BOAT_API_KEY` is set. Each computer is a Boat sandbox, named by the computer's ID, made from the saved snapshot `clutchbox-computer` (`BOAT_COMPUTER_SNAPSHOT` for another name), which `bun run build-template` builds on your account. Without the snapshot, a computer starts from Boat's default sandbox and installs what the snapshot holds (`src/setup.ts`) first.

The desktop, Chrome, sync, live view, and the CDP bridge are the E2B package's (`desktopSession`), run through Boat's command and file APIs (`boatMachine`). Where Boat differs:

- A pause quits Chrome, so its cookies reach disk, then stops the sandbox. A resume within about ten minutes finds the machine still up; later ones reboot it, and the session says so (`rebooted`), so the server applies the whole capture again and the computer returns to the screen it last set. Open tabs never survive a pause.
- Sandboxes are created with no environment and monitoring off, so Boat keeps no command history. Cookie payloads and typed text go through a tmpfs at `/tmp/clutchbox`, never a command line.
- Ports are reached through Boat's private hosted URLs, with the port's token in the query: Boat's proxy refuses its cookie on a WebSocket that carries an Origin, which the relays send.
- A stopped sandbox's disk is deleted after 14 days.

`SMOKE_PROVIDER=boat bun run computer:smoke` checks it live; `src/index.test.ts` covers the adapter against a stub only.

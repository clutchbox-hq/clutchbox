// Timings for computers on Boat. Measured on our account in November 2026 (one run each, so generous margins): a create
// was ready in 3.7-5.6 s and a resume a minute after a stop in 2.7 s, a stop took 8 s, and a command round trip about
// 250 ms.

// Waits for a created or resumed sandbox to accept commands: ten times the slowest ready seen.
export const READY_MS = 60_000;
// Waits for a stopping sandbox to finish stopping before it can resume: about four times the stop measured.
export const SETTLE_MS = 30_000;
// A control-plane call (get, update, stop, delete, host a port), as E2B's PROVIDER_REQUEST_MS bounds its own.
export const BOAT_REQUEST_MS = 15_000;
// How long past a command's own timeout the client waits for Boat's answer before giving up on it: Boat ends the
// command at its timeout (whole seconds, rounded up) and answers soon after.
export const COMMAND_MARGIN_MS = 5_000;
// Boat runs a command for at most this long.
export const COMMAND_MAX_SECONDS = 600;
// Chrome's graceful quit before a stop, so the cookies it holds reach disk (STOP_CHROME): its own close is usually
// done in a second, and SIGKILL follows this.
export const STOP_CHROME_SECONDS = 5;

import type { BoatApi, CommandResponse } from '@boatdev/sdk';
import { HELPER_DIR, REVISION, REVISION_FILE, writeHelpers } from '@clutchbox/e2b';

// What a fresh default Boat sandbox lacks for our helpers, run as root: once to make the snapshot computers start from,
// or on each new computer while there is no snapshot.
// Boat's image already has Google Chrome, Node 24, xdotool, xrandr, ImageMagick's import, and an Xorg desktop on :0
// (1920x1080). It lacks x11vnc and websockify for live view: websockify comes from Ubuntu, behind the path the helpers
// use on E2B, where it ships with noVNC.
export const SETUP = [
  'set -e',
  'export DEBIAN_FRONTEND=noninteractive',
  'apt-get update -q',
  'apt-get install -y -q x11vnc websockify fonts-noto-cjk',
  'mkdir -p /opt/noVNC/utils/websockify',
  `printf '#!/bin/sh\\nexec websockify "$@"\\n' > /opt/noVNC/utils/websockify/run`,
  'chmod 755 /opt/noVNC/utils/websockify/run',
  `mkdir -p ${HELPER_DIR}`,
  writeHelpers(),
  // Computers from this snapshot start on REVISION, so their first open skips the refresh's restart.
  `echo ${REVISION} > ${REVISION_FILE}`,
  'node --version && google-chrome --version && x11vnc -version >/dev/null 2>&1; websockify --help | grep -q auth-plugin',
  'rm -rf /var/lib/apt/lists/*',
].join('\n');

// Runs SETUP on a sandbox, through a file rather than the command line, and answers its output's last lines.
export async function runSetup(boat: BoatApi, sandboxId: string, signal?: AbortSignal) {
  const setup = (await boat.command(
    {
      sandboxId,
      command: `echo ${Buffer.from(SETUP).toString('base64')} | base64 -d | sudo -n sh -s`,
      timeoutSeconds: 600,
    },
    signal ? { signal } : {},
  )) as CommandResponse;
  if (setup.exitCode !== 0) throw new Error(`setup exited ${setup.exitCode}: ${setup.stderr.slice(-2000)}`);
  return setup.stdout.trim().split('\n').slice(-3).join('\n');
}

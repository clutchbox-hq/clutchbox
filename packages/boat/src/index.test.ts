import type { BoatApi } from '@boatdev/sdk';
import { CommandExit, CommandTimeout } from '@clutchbox/e2b';
import { describe, expect, it } from 'vitest';
import { boatMachine } from './index.ts';

// A stand-in for Boat's API that records commands and answers each with `answer`. It is NOT evidence about Boat: the
// live smoke (SMOKE_PROVIDER=boat bun run computer:smoke) is.
const fakeBoat = (answer: (command: string) => object = () => ({ exitCode: 0, stdout: 'ok', stderr: '' })) => {
  const commands: { command: string; timeoutSeconds: number }[] = [];
  const writes: { path: string; content: string; encoding: string }[] = [];
  const boat = {
    async command({ command, timeoutSeconds }: { command: string; timeoutSeconds: number }) {
      commands.push({ command, timeoutSeconds });
      return { timedOut: false, ...answer(command) };
    },
    async writeFile(file: { path: string; content: string; encoding: string }) {
      writes.push(file);
      return {};
    },
    async hostPort({ port }: { port: number }) {
      return { url: `https://box-node-1-${port}.on.boat.dev/?_token=secret` };
    },
  };
  return { boat: boat as unknown as BoatApi, commands, writes };
};

describe('boatMachine', () => {
  it('runs root commands through sudo, with the display exported, in whole seconds', async () => {
    const { boat, commands } = fakeBoat();
    const machine = boatMachine(boat, 'sbx');
    await machine.run("echo 'hi'", { user: 'root', display: true, timeoutMs: 1500 });
    expect(commands).toEqual([{ command: `sudo -n sh -c 'export DISPLAY=:0\necho '\\''hi'\\'''`, timeoutSeconds: 2 }]);
  });
  it('throws CommandExit for a failed command and CommandTimeout for one Boat timed out', async () => {
    const failed = boatMachine(fakeBoat(() => ({ exitCode: 3, stdout: 'out', stderr: 'err' })).boat, 'sbx');
    await expect(failed.run('false', { timeoutMs: 1000 })).rejects.toMatchObject(new CommandExit(3, 'out', 'err'));
    const slow = boatMachine(fakeBoat(() => ({ exitCode: null, timedOut: true, stdout: '', stderr: '' })).boat, 'sbx');
    await expect(slow.run('sleep 9', { timeoutMs: 1000 })).rejects.toBeInstanceOf(CommandTimeout);
  });
  it('types from a file in memory, never the command line', async () => {
    const { boat, commands, writes } = fakeBoat();
    await boatMachine(boat, 'sbx').type('p@ss word');
    expect(writes).toEqual([
      {
        sandboxId: 'sbx',
        path: expect.stringMatching(/^\/tmp\/clutchbox\/type-/),
        content: 'p@ss word',
        encoding: 'utf8',
      },
    ]);
    expect(commands[0]!.command).not.toContain('p@ss');
  });
  it("reaches a port with its token in the query, since Boat's proxy refuses the cookie with an Origin", async () => {
    const { boat } = fakeBoat();
    expect(await boatMachine(boat, 'sbx').endpoint(6090)).toEqual({
      url: 'wss://box-node-1-6090.on.boat.dev/?_token=secret',
      headers: {},
    });
  });
});

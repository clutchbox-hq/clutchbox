import type { ComputerView } from './api.ts';

// Display helpers for the computer's state, shared by the sidebar, the overview, and the Computer page.

export const resetsOn = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

// How much of the credit is used, as a percentage for its bar.
export const usedShare = ({ usedShare }: NonNullable<ComputerView['usage']>) => Math.min(100, usedShare * 100);

const count = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;
// The billing period's use, such as "42 computer minutes · 318 MCP calls since Oct 1".
export const periodUse = ({ period }: ComputerView) =>
  `${count(period.minutes, 'computer minute')} · ${count(period.mcpCalls, 'MCP call')} since ${resetsOn(period.start)}`;

// What the member's computers are doing, for the sidebar, the overview, and the Computer page.
export function computerStatus(view: ComputerView) {
  const { computers } = view;
  if (!computers.length)
    return { short: 'None yet', note: 'One is made when an agent starts a task.', dot: 'bg-muted-foreground' };
  const working = computers.filter(computer => computer.status === 'in_use').length;
  if (working)
    return {
      short: 'In use',
      note: `${count(working, 'computer')} in use, of ${computers.length.toLocaleString()}.`,
      dot: 'bg-brand',
    };
  return { short: 'Ready', note: periodUse(view), dot: 'bg-foreground' };
}

// When the member's sign-ins were last copied, which every computer gets each time it opens.
export function syncedSignIns({ capture }: ComputerView) {
  return capture && { copiedAt: capture.completedAt };
}

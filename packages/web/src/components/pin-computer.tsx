'use client';
import { Button } from '@clutchbox/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@clutchbox/ui/components/dialog';
import { Input } from '@clutchbox/ui/components/input';
import { Label } from '@clutchbox/ui/components/label';
import { Pin, PinOff } from 'lucide-react';
import { useId, useState } from 'react';
import { type ComputerView, usePinComputer, useUnpinComputer } from '../lib/api.ts';
import { Failure } from './failure.tsx';

type Fork = ComputerView['forks'][number];

// Pin, rename, and unpin for one of the agents' computers on the Computer page. Pinning asks for a name, which agents
// find it by; a pinned computer is never deleted for disuse.
export function PinActions({ fork }: { fork: Fork }) {
  const [naming, setNaming] = useState(false);
  const unpin = useUnpinComputer();
  if (!fork.pinned)
    return (
      <>
        <Button variant="ghost" size="sm" disabled={fork.status === 'starting'} onClick={() => setNaming(true)}>
          <Pin aria-hidden />
          Pin
        </Button>
        {naming && <NameDialog fork={fork} onClose={() => setNaming(false)} />}
      </>
    );
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setNaming(true)}>
        Rename
      </Button>
      <Button variant="ghost" size="sm" disabled={unpin.isPending} onClick={() => unpin.mutate(fork.computerId)}>
        <PinOff aria-hidden />
        {unpin.isPending ? 'Unpinning…' : 'Unpin'}
      </Button>
      {naming && <NameDialog fork={fork} onClose={() => setNaming(false)} />}
      {unpin.isError && <Failure error={unpin.error} />}
    </>
  );
}

// Names the computer to pin it, or renames a pinned one. Mounted while open, so each opening starts from its name.
function NameDialog({ fork, onClose }: { fork: Fork; onClose: () => void }) {
  const fieldId = useId();
  const [name, setName] = useState(fork.label ?? '');
  const pin = usePinComputer();
  return (
    <Dialog
      open
      onOpenChange={next => {
        if (!next && !pin.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{fork.pinned ? 'Rename computer' : 'Pin computer'}</DialogTitle>
          <DialogDescription>
            A pinned computer keeps its files, tabs, and tools, and is never deleted for disuse. Your agents find it by
            this name, and it still gets your newest sign-ins each time it opens.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={event => {
            event.preventDefault();
            pin.mutate({ computer: fork.computerId, label: name.trim() }, { onSuccess: onClose });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={fieldId}>Name</Label>
            <Input
              id={fieldId}
              required
              maxLength={100}
              placeholder="Research"
              value={name}
              onChange={event => setName(event.target.value)}
            />
          </div>
          <Failure error={pin.error} />
          <DialogFooter>
            <Button type="submit" disabled={pin.isPending || !name.trim()}>
              {pin.isPending ? 'Saving…' : fork.pinned ? 'Save' : 'Pin'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

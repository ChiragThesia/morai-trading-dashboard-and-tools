import { Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input } from "@morai/web";

/**
 * Open by default so the popup renders inside the card — a closed Dialog paints nothing.
 * The portal escapes the grid, so this component is pinned to cardMode:"single" in config.
 */
export function Open() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roll 7500P → 7400P</DialogTitle>
          <DialogDescription>
            Closes the front leg and opens a new one 100 points lower. The journal chain is re-registered from broker fills.
          </DialogDescription>
        </DialogHeader>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Input defaultValue="7400" />
          <div className="text-muted-foreground text-xs">Estimated debit $1 240.00 · realized −$169.00</div>
        </div>
        <DialogFooter showCloseButton>
          <Button variant="primary" size="sm">Confirm roll</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The trigger in its closed state — this is what sits in the page. */
export function Trigger() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" size="sm" />}>Roll position…</DialogTrigger>
    </Dialog>
  );
}

/** A confirm dialog with no footer close button — actions only. */
export function Confirm() {
  return (
    <Dialog open>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Close this calendar?</DialogTitle>
          <DialogDescription>Both legs are sold at the mid. This cannot be undone from the dashboard.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" size="sm" />}>Cancel</DialogClose>
          <Button variant="destructive" size="sm">Close position</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

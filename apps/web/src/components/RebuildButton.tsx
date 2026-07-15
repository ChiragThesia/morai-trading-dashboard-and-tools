import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/system/index.tsx";
import { useRebuildJournal } from "../hooks/useRebuildJournal.ts";

/**
 * RebuildButton — per-calendar journal rebuild trigger (REBUILD-01).
 *
 * Opens a shadcn Dialog with the LOCKED destructive confirmation copy
 * per UI-SPEC "Empty / loading / error states":
 *   "Rebuild journal for "{calendarId}"? This overwrites all snapshot history. [Rebuild] [Cancel]"
 *
 * On [Rebuild]: fires the useRebuildJournal mutation with the given calendarId.
 * On [Cancel]: dismisses without firing.
 *
 * The button itself is labeled "Rebuild journal…" (ellipsis indicates a dialog follows).
 * Styled as a destructive secondary action (coral on dark bg, not a primary CTA).
 *
 * Security: the mutation is guarded by the Bearer auth header in apiFetch (T-09-01).
 */

interface RebuildButtonProps {
  /** Calendar ID to rebuild. Passed as calendarId in the POST body. */
  calendarId: string;
}

export function RebuildButton({ calendarId }: RebuildButtonProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rebuild = useRebuildJournal();

  function handleRebuild(): void {
    rebuild.mutate(calendarId, {
      onSettled: () => {
        setOpen(false);
      },
    });
  }

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
        aria-label={`Rebuild journal for ${calendarId}`}
      >
        Rebuild journal…
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-w-[400px] bg-gradient-to-b from-panel to-panel2 ring-1 ring-line"
        >
          <DialogHeader>
            <DialogTitle className="font-display text-sm font-bold text-txt">
              Rebuild journal for &ldquo;{calendarId}&rdquo;?
            </DialogTitle>
            <DialogDescription className="font-mono text-[11px] text-muted-foreground">
              This overwrites all snapshot history.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter style={{ gap: 8 }}>
            <DialogClose render={<Button variant="secondary" size="sm" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              size="sm"
              disabled={rebuild.isPending}
              onClick={handleRebuild}
            >
              {rebuild.isPending ? "Rebuilding…" : "Rebuild"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

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
import { Button } from "@/components/ui/button";
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
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
        style={{
          borderColor: "#3e1f23",
          color: "#ef5350",
          fontSize: 10,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        }}
        aria-label={`Rebuild journal for ${calendarId}`}
      >
        Rebuild journal…
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          style={{
            background: "linear-gradient(180deg, #0f1521, #0c111a)",
            border: "1px solid #1b2433",
            maxWidth: 400,
          }}
        >
          <DialogHeader>
            <DialogTitle
              style={{
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontSize: 14,
                fontWeight: 700,
                color: "#d6dbe4",
              }}
            >
              Rebuild journal for &ldquo;{calendarId}&rdquo;?
            </DialogTitle>
            <DialogDescription
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
                color: "#7b8696",
              }}
            >
              This overwrites all snapshot history.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter style={{ gap: 8 }}>
            <DialogClose
              render={
                <Button
                  variant="outline"
                  size="sm"
                  style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11 }}
                />
              }
            >
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              disabled={rebuild.isPending}
              onClick={handleRebuild}
              style={{
                background: "#ef5350",
                color: "#0a0e14",
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
              }}
            >
              {rebuild.isPending ? "Rebuilding…" : "Rebuild"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

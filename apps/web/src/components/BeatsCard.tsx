import { Panel, PanelHeading } from "./system/index.tsx";

/**
 * BeatsCard — "the beats" event list (D-08, JRNL-01). Pure presentational list over a
 * `beats` prop — it does NOT read/filter `snapshots` itself; Journal.tsx (plan 22-06)
 * builds the beats array (entry from calendar.openedAt, event-move beats from snapshots
 * where `trigger === "event-move"`, close from calendar.closedAt).
 *
 * Dot colors per 22-UI-SPEC.md "Event verticals": entry --color-violet, scheduled/adverse
 * event --color-amber (default) / --color-down, close contextual (neutral by default —
 * BeatsCard has no P&L-outcome signal of its own to color it directionally).
 */

export type BeatKind = "entry" | "event" | "close";

export interface Beat {
  readonly date: string;
  readonly kind: BeatKind;
  readonly label: string;
}

export interface BeatsCardProps {
  readonly beats: ReadonlyArray<Beat>;
}

const DOT_CLASS: Readonly<Record<BeatKind, string>> = {
  entry: "bg-violet",
  event: "bg-amber",
  close: "bg-muted-foreground",
};

export function BeatsCard({ beats }: BeatsCardProps): React.ReactElement {
  return (
    <Panel>
      <PanelHeading title="The beats" />
      {beats.length === 0 ? (
        <div className="font-mono text-[11px] text-dim">No beats recorded yet.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {beats.map((beat, i) => (
            <div key={`${beat.date}-${beat.kind}-${i}`} className="flex gap-2">
              <span
                className={`mt-[5px] h-[7px] w-[7px] flex-none rounded-full ${DOT_CLASS[beat.kind]}`}
              />
              <div>
                <div className="font-mono text-[9px] text-dim">{beat.date}</div>
                <div className="font-display text-[11px] leading-[1.4] text-muted-foreground">
                  {beat.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

import { Panel, SectionLabel } from "@morai/web";

/** The two tones: `muted` for card titles, `dim` for fainter section dividers. */
export function Tones() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 360 }}>
      <div>
        <SectionLabel>Suggested calendars</SectionLabel>
        <div className="font-mono text-muted-foreground">default — card titles</div>
      </div>
      <div>
        <SectionLabel tone="dim">Scoring context</SectionLabel>
        <div className="font-mono text-muted-foreground">tone="dim" — section dividers</div>
      </div>
    </div>
  );
}

/** In place: every Panel opens with one. */
export function InPanel() {
  return (
    <Panel style={{ maxWidth: 360 }}>
      <SectionLabel>Term structure</SectionLabel>
      <div className="font-mono text-muted-foreground" style={{ marginTop: 6 }}>front 12.49% · back 14.02% · fwd 15.31%</div>
    </Panel>
  );
}

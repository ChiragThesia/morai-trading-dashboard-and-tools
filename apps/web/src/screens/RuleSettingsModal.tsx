/**
 * RuleSettingsModal — the gear-icon settings modal (Phase 29-14, CONTEXT.md UI lock).
 *
 * Grouped by engine: Entry/Picker · Exit Advisor · Regime Bands. Each knob shows its
 * effective value; when overridden, its default is shown alongside so the operator sees
 * drift from baseline. Each group has its own Save (calls saveGroup) and Reset to defaults
 * (calls resetGroup, T-29-19: non-optimistic — the mutation itself never flips local state
 * before the PUT resolves).
 *
 * Uses the existing Dialog wrapper (apps/web/src/components/ui/dialog.tsx) and the shared
 * <Button> primitive (Phase 21) per CONTEXT.md's lock — no hand-rolled modal or inputs.
 */
import { useState } from "react";
import { Settings } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog.tsx";
import { Button, Panel, PanelHeading } from "../components/system/index.tsx";
import { useRuleSettings } from "../hooks/useRuleSettings.ts";
import type { RuleSettingsGroup } from "../hooks/useRuleSettings.ts";

interface LeafRow {
  readonly path: ReadonlyArray<string>;
  readonly value: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Walks a RuleConfig group (nested objects of numbers) into a flat list of leaf rows. */
function flattenNumeric(node: unknown, prefix: ReadonlyArray<string> = []): ReadonlyArray<LeafRow> {
  if (typeof node === "number") return [{ path: prefix, value: node }];
  if (isRecord(node)) {
    return Object.entries(node).flatMap(([key, child]) => flattenNumeric(child, [...prefix, key]));
  }
  return [];
}

/** Looks up a leaf by path in an arbitrary (possibly partial/null) config tree. */
function lookupLeaf(node: unknown, path: ReadonlyArray<string>): number | undefined {
  let current: unknown = node;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === "number" ? current : undefined;
}

/** Rebuilds a nested group object from a flat leaf-row list (every leaf of the shape). */
function unflatten(rows: ReadonlyArray<LeafRow>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const row of rows) {
    let node = root;
    for (let i = 0; i < row.path.length - 1; i += 1) {
      const key = row.path[i];
      if (key === undefined) continue;
      const raw = node[key];
      const child: Record<string, unknown> = isRecord(raw) ? raw : {};
      node[key] = child;
      node = child;
    }
    const lastKey = row.path[row.path.length - 1];
    if (lastKey !== undefined) node[lastKey] = row.value;
  }
  return root;
}

function humanize(segment: string): string {
  const spaced = segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function pathLabel(path: ReadonlyArray<string>): string {
  return path.map(humanize).join(" ");
}

const GROUPS: ReadonlyArray<{ readonly group: RuleSettingsGroup; readonly title: string }> = [
  { group: "picker", title: "Entry/Picker" },
  { group: "exits", title: "Exit Advisor" },
  { group: "regime", title: "Regime Bands" },
];

interface GroupPanelProps {
  readonly group: RuleSettingsGroup;
  readonly title: string;
  readonly effectiveGroup: unknown;
  readonly defaultsGroup: unknown;
  readonly overridesGroup: unknown;
  readonly error: string | undefined;
  readonly onSave: (group: RuleSettingsGroup, patch: Record<string, unknown>) => Promise<void>;
  readonly onReset: (group: RuleSettingsGroup) => Promise<void>;
}

function GroupPanel({
  group,
  title,
  effectiveGroup,
  defaultsGroup,
  overridesGroup,
  error,
  onSave,
  onReset,
}: GroupPanelProps): React.ReactElement {
  const rows = flattenNumeric(effectiveGroup);
  const [draft, setDraft] = useState<Record<string, string>>({});

  function keyFor(row: LeafRow): string {
    return row.path.join(".");
  }

  function handleChange(row: LeafRow, next: string): void {
    setDraft((prev) => ({ ...prev, [keyFor(row)]: next }));
  }

  async function handleSave(): Promise<void> {
    const patchRows = rows.map((row) => {
      const raw = draft[keyFor(row)];
      // A cleared field (user clicked in, deleted the value) sets draft to "", not undefined
      // -- Number("") === 0, so treat it the same as untouched (WR-02, 29-REVIEW.md): fall
      // back to the current effective value rather than silently saving 0.
      const parsed = raw === undefined || raw === "" ? row.value : Number(raw);
      return { path: row.path, value: Number.isFinite(parsed) ? parsed : row.value };
    });
    await onSave(group, unflatten(patchRows));
    setDraft({});
  }

  return (
    <Panel data-testid={`settings-group-${group}`}>
      <PanelHeading
        title={title}
        action={
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              // fire-and-forget: the hook owns pending/error state for this group.
              void onReset(group);
            }}
          >
            Reset to defaults
          </Button>
        }
      />
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const overridden = lookupLeaf(overridesGroup, row.path) !== undefined;
          const defaultValue = lookupLeaf(defaultsGroup, row.path);
          const label = pathLabel(row.path);
          return (
            <div key={keyFor(row)} className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-dim">{label}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  aria-label={label}
                  value={draft[keyFor(row)] ?? String(row.value)}
                  onChange={(e) => {
                    handleChange(row, e.target.value);
                  }}
                  className="w-20 rounded-[3px] border border-line2 bg-raise px-1.5 py-0.5 font-mono text-[10px] text-txt"
                />
                {overridden && defaultValue !== undefined && (
                  <span className="font-mono text-[9px] text-dim">default {defaultValue}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {error !== undefined && <span className="font-mono text-[9px] text-down">{error}</span>}
        <Button
          variant="primary"
          size="xs"
          className="ml-auto"
          onClick={() => {
            // fire-and-forget: the hook owns pending/error state for this group.
            void handleSave();
          }}
        >
          Save
        </Button>
      </div>
    </Panel>
  );
}

export function RuleSettingsModal(): React.ReactElement {
  const { defaults, overrides, effective, errors, saveGroup, resetGroup } = useRuleSettings();

  return (
    <Dialog>
      <DialogTrigger
        data-testid="settings-trigger"
        aria-label="Settings"
        render={<Button variant="ghost" size="xs" className="h-8 w-8 p-0" />}
      >
        <Settings className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rule settings</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
          {GROUPS.map(({ group, title }) => (
            <GroupPanel
              key={group}
              group={group}
              title={title}
              effectiveGroup={effective?.[group]}
              defaultsGroup={defaults?.[group]}
              overridesGroup={overrides?.[group]}
              error={errors[group]}
              onSave={saveGroup}
              onReset={resetGroup}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

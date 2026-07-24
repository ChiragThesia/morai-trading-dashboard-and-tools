import { Textarea } from "@morai/web";

const stack = { display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 } as const;

/** Empty with placeholder, and filled with a real journal note. */
export function States() {
  return (
    <div style={stack}>
      <Textarea placeholder="Why did you take this trade?" />
      <Textarea defaultValue={"Rolled 7500P -> 7400P after the front went bid-side on the NFP print.\nBE pair now 7413 / 7691 vs TOS 7421 / 7673."} />
      <Textarea defaultValue="Locked — calendar closed." disabled />
    </div>
  );
}

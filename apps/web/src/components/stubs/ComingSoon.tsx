/**
 * ComingSoon — reusable badged coming-soon placeholder stub.
 *
 * Visual spec from UI-SPEC "Coming-Soon Stubs Contract":
 *   - Dashed border #27313f, border-radius 8px, padding 16px (md token)
 *   - Centered flex column
 *   - Badge: label token text, color #566273
 *   - Title: label token bold, color #d6dbe4 or #566273
 *   - Body: label token, color #566273
 *
 * Never throws, never returns null — renders the placeholder unconditionally.
 * Used for:
 *   - Overview: economic calendar (badge="○ needs feed")
 *   - Market: Charm/Vanna (badge="○ next"), Intraday flow (badge="○ needs denser snapshots")
 */

interface ComingSoonProps {
  /** Badge text above the title, e.g. "○ needs feed" */
  badge: string;
  /** Stub heading, e.g. "Catalysts" or "Charm & Vanna by strike" */
  title: string;
  /** Descriptive body text explaining what will be here */
  body: string;
  /** Optional minimum height (matches adjacent content per screen) */
  minHeight?: number;
  /** Optional additional inline styles */
  style?: React.CSSProperties;
}

/**
 * ComingSoon — reusable dashed-border placeholder (never an error, never omitted).
 *
 * UI-SPEC locked visual: dashed border `#27313f`, radius 8px, padding 16px,
 * centered flex column, label token for badge/title/body.
 */
export function ComingSoon({
  badge,
  title,
  body,
  minHeight,
  style,
}: ComingSoonProps): React.ReactElement {
  return (
    <div
      style={{
        border: "1px dashed #27313f",
        borderRadius: "8px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        minHeight: minHeight !== undefined ? `${minHeight}px` : undefined,
        ...style,
      }}
    >
      {/* Badge — "○ needs feed" / "○ next" / "○ needs denser snapshots" */}
      <span
        style={{
          fontSize: "10px",
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontWeight: 600,
          color: "#566273",
          letterSpacing: "0.9px",
        }}
      >
        {badge}
      </span>

      {/* Title */}
      <span
        style={{
          fontSize: "10px",
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.9px",
          color: "#d6dbe4",
          textAlign: "center",
        }}
      >
        {title}
      </span>

      {/* Body */}
      <span
        style={{
          fontSize: "10px",
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          color: "#566273",
          textAlign: "center",
          lineHeight: 1.45,
        }}
      >
        {body}
      </span>
    </div>
  );
}

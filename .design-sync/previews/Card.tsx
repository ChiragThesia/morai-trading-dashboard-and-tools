import { Badge, Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@morai/web";

/** The full composition — header (title + description + action), content, footer. */
export function Composed() {
  return (
    <Card style={{ maxWidth: 420 }}>
      <CardHeader>
        <CardTitle>Schwab connection</CardTitle>
        <CardDescription>Token refreshes on use. Re-auth is due every 7 days.</CardDescription>
        <CardAction>
          <Badge variant="outline">healthy</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div className="text-muted-foreground text-xs">Last chain fetch</div>
            <div className="font-mono">14:32:07Z</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Contracts</div>
            <div className="font-mono">24,118</div>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="secondary" size="sm">Re-authenticate</Button>
      </CardFooter>
    </Card>
  );
}

/** size="sm" tightens --card-spacing throughout the whole card. */
export function SizeSmall() {
  return (
    <Card size="sm" style={{ maxWidth: 320 }}>
      <CardHeader>
        <CardTitle>Worker</CardTitle>
        <CardDescription>pg-boss · 8 crons registered</CardDescription>
      </CardHeader>
      <CardContent className="font-mono">last job 12s ago</CardContent>
    </Card>
  );
}

/** Content-only — no header, no footer. */
export function ContentOnly() {
  return (
    <Card style={{ maxWidth: 320 }}>
      <CardContent>
        <div className="text-muted-foreground text-xs">NET GAMMA</div>
        <div className="font-mono text-2xl">−$57.4B</div>
      </CardContent>
    </Card>
  );
}

import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@morai/web";

/**
 * Open by default so the popup paints inside the card. The popup portals out of the
 * grid cell, so this component is pinned to cardMode:"single" in config.
 */
export function Open() {
  return (
    <TooltipProvider>
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 64 }}>
        <Tooltip open>
          <TooltipTrigger render={<Button variant="secondary" size="sm" />}>net γ</TooltipTrigger>
          <TooltipContent side="bottom">Dealer gamma across the full SPX chain, in $ per 1-point move.</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

/** Each side the popup can be positioned on. */
export function Sides() {
  return (
    <TooltipProvider>
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
        <Tooltip open>
          <TooltipTrigger render={<Button variant="secondary" size="sm" />}>flip 7 450</TooltipTrigger>
          <TooltipContent side="right">Gamma flip point — above it dealers are long gamma.</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

/** Closed — the trigger as it sits inline in a stat row. */
export function TriggerOnly() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="xs" />}>put wall 7 400</TooltipTrigger>
        <TooltipContent>Largest put gamma strike below spot.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

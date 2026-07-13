/**
 * ReauthWizard — the Schwab re-auth modal (Phase 37-06, UI-SPEC-locked copy/color/spacing).
 *
 * Mirrors RuleSettingsModal's Dialog structure. Drives a sequential trader -> market step
 * machine, with per-app failure isolation (a scoped Retry re-enters only the failed app's
 * idle step) and silent auto-resume on landing back from Schwab.
 *
 * Cross-redirect continuity: each OAuth leg is a full same-tab navigation away and back, which
 * destroys all React state, so a small `sessionStorage` record of which apps have already
 * succeeded lets a fresh mount (after the market leg's redirect) resume at the Market step with
 * the Trader chip filled. The exchange response's `app` field (server-determined from its own
 * nonce lookup) drives the actual state transition.
 *
 * WR-03: sessionStorage is continuity only, never the freshness authority. The initial seed also
 * consults the live `expiredApps` (derived from /api/status tokenFreshness by the banner): an app
 * is pre-filled `success` only when the completed-set lists it AND its live token is not
 * AUTH_EXPIRED. That stops a stale completed-set (left over from a prior 7-day cycle) from skipping
 * an app that has genuinely re-expired.
 *
 * ponytail: sessionStorage here is a plain completed-apps set (not itself keyed by the OAuth
 * state nonce) — sufficient for a strictly-sequential 2-step wizard, add per-nonce tracking only
 * if a non-sequential resume path is ever introduced.
 */
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog.tsx";
import { Button, buttonClass } from "./system/index.tsx";
import { useReauth } from "../hooks/useReauth.ts";
import type { ReauthApp } from "../hooks/useReauth.ts";
import { consumeCapturedRedirect } from "../lib/reauth-callback.ts";

type StepStatus = "idle" | "confirming" | "success" | "failure";

interface WizardState {
  readonly currentStep: ReauthApp;
  readonly statuses: Record<ReauthApp, StepStatus>;
  readonly done: boolean;
}

const STEP_ORDER: ReadonlyArray<ReauthApp> = ["trader", "market"];
const STEP_LABEL: Record<ReauthApp, string> = { trader: "Trader (1/2)", market: "Market (2/2)" };
const APP_LABEL: Record<ReauthApp, string> = { trader: "Trader", market: "Market" };

const COMPLETED_KEY = "reauth-completed-apps";

function isReauthApp(value: unknown): value is ReauthApp {
  return value === "trader" || value === "market";
}

function readCompletedApps(): ReadonlySet<ReauthApp> {
  try {
    const raw = sessionStorage.getItem(COMPLETED_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(isReauthApp));
  } catch {
    return new Set();
  }
}

function persistCompletedApp(app: ReauthApp): void {
  const completed = new Set(readCompletedApps());
  completed.add(app);
  if (completed.size === STEP_ORDER.length) {
    sessionStorage.removeItem(COMPLETED_KEY); // both apps done — clear for the next 7-day cycle
  } else {
    sessionStorage.setItem(COMPLETED_KEY, JSON.stringify([...completed]));
  }
}

function computeInitialState(expiredApps: ReadonlySet<ReauthApp>): WizardState {
  const completed = readCompletedApps();
  // WR-03: pre-fill an app `success` only when sessionStorage recorded it AND its live token is
  // not AUTH_EXPIRED — a genuinely re-expired app is never skipped by a stale completed-set.
  const seededSuccess = (app: ReauthApp): boolean => completed.has(app) && !expiredApps.has(app);
  const currentStep: ReauthApp = STEP_ORDER.find((app) => !seededSuccess(app)) ?? "market";
  return {
    currentStep,
    statuses: {
      trader: seededSuccess("trader") ? "success" : "idle",
      market: seededSuccess("market") ? "success" : "idle",
    },
    done: STEP_ORDER.every(seededSuccess),
  };
}

function nextStep(app: ReauthApp): ReauthApp | "done" {
  return app === "trader" ? "market" : "done";
}

interface ReauthWizardProps {
  /** Apps whose live token is AUTH_EXPIRED (from /api/status tokenFreshness, via the banner). */
  readonly expiredApps: ReadonlyArray<ReauthApp>;
}

export function ReauthWizard({ expiredApps }: ReauthWizardProps): React.ReactElement {
  const { startReauth, exchangeReauth } = useReauth();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<WizardState>(() => computeInitialState(new Set(expiredApps)));

  useEffect(() => {
    const redirect = consumeCapturedRedirect();
    if (redirect === null) return;

    setOpen(true);
    setState((prev) => ({ ...prev, statuses: { ...prev.statuses, [prev.currentStep]: "confirming" } }));

    exchangeReauth(redirect)
      .then((response) => {
        if (response.ok) {
          persistCompletedApp(response.app);
        }
        setState((prev) => {
          if (!response.ok) {
            return { ...prev, statuses: { ...prev.statuses, [response.app]: "failure" } };
          }
          const advance = nextStep(response.app);
          return {
            currentStep: advance === "done" ? prev.currentStep : advance,
            statuses: { ...prev.statuses, [response.app]: "success" },
            done: advance === "done",
          };
        });
      })
      .catch(() => {
        setState((prev) => ({ ...prev, statuses: { ...prev.statuses, [prev.currentStep]: "failure" } }));
      });
    // Runs once per mount: consumeCapturedRedirect() is a module-level one-shot (Task 1) — a
    // StrictMode double-invoke's second call observes `null` and no-ops here (RESEARCH Pitfall 5).
  }, []);

  function handleAuthorize(app: ReauthApp): void {
    // Mirror the exchange path (WR-01): show `confirming` while /start is in flight and surface a
    // rejection as the scoped `failure` step (failure copy + Retry) — a swallowed /start left the
    // Authorize button silently dead with no feedback.
    setState((prev) => ({ ...prev, statuses: { ...prev.statuses, [app]: "confirming" } }));
    startReauth(app)
      .then((response) => {
        window.location.href = response.authUrl;
      })
      .catch(() => {
        setState((prev) => ({ ...prev, statuses: { ...prev.statuses, [app]: "failure" } }));
      });
  }

  function handleRetry(app: ReauthApp): void {
    setState((prev) => ({ ...prev, currentStep: app, statuses: { ...prev.statuses, [app]: "idle" } }));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="primary" tone="violet" size="touch" />}>
        Reconnect
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reconnect Schwab</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          {STEP_ORDER.map((step) => (
            <span
              key={step}
              data-testid={`reauth-step-chip-${step}`}
              className={buttonClass({
                variant: "toggle",
                tone: "violet",
                active: state.statuses[step] === "success" || state.currentStep === step,
                size: "xs",
              })}
            >
              {STEP_LABEL[step]}
            </span>
          ))}
        </div>
        {state.done ? (
          <div className="flex flex-col gap-3">
            <div className="font-mono text-[12px] leading-[1.45] text-txt">
              Reconnected. Live data resumes on the next status check.
            </div>
            <Button variant="secondary" size="touch" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          (() => {
            const step = state.currentStep;
            const status = state.statuses[step];
            return (
              <div className="flex flex-col gap-3">
                {status === "idle" && (
                  <>
                    <div className="font-mono text-[12px] leading-[1.45] text-txt">
                      Click Authorize with Schwab to reconnect the {step} app.
                    </div>
                    <Button
                      variant="primary"
                      tone="violet"
                      size="touch"
                      onClick={() => handleAuthorize(step)}
                    >
                      Authorize with Schwab
                    </Button>
                  </>
                )}
                {status === "confirming" && (
                  <div className="font-mono text-[12px] leading-[1.45] text-dim">Confirming…</div>
                )}
                {status === "success" && (
                  <div className="flex items-center gap-1 font-mono text-[12px] leading-[1.45] text-up">
                    <Check className="h-3 w-3" /> {APP_LABEL[step]} connected.
                  </div>
                )}
                {status === "failure" && (
                  <>
                    <div className="font-mono text-[12px] leading-[1.45] text-down">
                      {APP_LABEL[step]} reconnect failed — Schwab didn&apos;t confirm a fresh token.
                    </div>
                    <Button variant="secondary" size="touch" onClick={() => handleRetry(step)}>
                      Retry
                    </Button>
                  </>
                )}
              </div>
            );
          })()
        )}
      </DialogContent>
    </Dialog>
  );
}

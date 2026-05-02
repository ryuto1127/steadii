export type OnboardingStatus = {
  notionConnected: boolean;
  notionSetupComplete: boolean;
  calendarConnected: boolean;
  gmailConnected: boolean;
  // Phase 7 W-Integrations — Step 2 is "skip-once" per locked decision Q1.
  // Set when the user clicks Skip OR when the user has connected at least
  // one optional integration via the page. Either way the page never
  // re-shows; contextual prompts (Surface 2) keep working.
  integrationsStepCompleted: boolean;
  // Wave 2 (2026-05-01) — Step 3 is the commitment + wait screen.
  // Resolved when the user clicks "Take me to Home" (one-shot — the
  // dismissal timestamp is stored in `users.preferences`). Re-asking
  // would feel patronising on returning sessions.
  waitStepCompleted: boolean;
};

// Wave 2 lock: onboarding is complete once Google is connected
// (Calendar + Gmail bundled in one consent), the optional-integrations
// step has been resolved, AND the wait/commitment step (Step 3) has
// been dismissed.
export function isOnboardingComplete(status: OnboardingStatus): boolean {
  return (
    status.gmailConnected &&
    status.calendarConnected &&
    status.integrationsStepCompleted &&
    status.waitStepCompleted
  );
}

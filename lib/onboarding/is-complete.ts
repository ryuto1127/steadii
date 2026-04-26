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
};

// Phase 7 W-Integrations: onboarding is complete once Google is connected
// (Calendar + Gmail bundled in one consent) AND the optional-integrations
// step has been resolved (skipped or any integration clicked through).
export function isOnboardingComplete(status: OnboardingStatus): boolean {
  return (
    status.gmailConnected &&
    status.calendarConnected &&
    status.integrationsStepCompleted
  );
}

export type OnboardingStatus = {
  notionConnected: boolean;
  notionSetupComplete: boolean;
  calendarConnected: boolean;
  gmailConnected: boolean;
};

// Phase 6: Notion is optional (accuracy booster). Onboarding is complete
// once Google is connected with both Calendar + Gmail scopes granted.
// Notion may be added later from Settings.
export function isOnboardingComplete(status: OnboardingStatus): boolean {
  return status.gmailConnected && status.calendarConnected;
}

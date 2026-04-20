export type OnboardingStatus = {
  notionConnected: boolean;
  notionSetupComplete: boolean;
  calendarConnected: boolean;
};

export function isOnboardingComplete(status: OnboardingStatus): boolean {
  return status.notionConnected && status.notionSetupComplete && status.calendarConnected;
}

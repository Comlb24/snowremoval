/**
 * Features that are built but not finished or not tested with real accounts yet.
 * While a feature is listed as true here, the app shows it as "coming soon" and it cannot be used.
 * To turn one back on, change it to false.
 */
export const COMING_SOON = {
  /** Forgot / reset password by email. Needs the /reset-password address added to Supabase redirect URLs, then a real test. */
  passwordReset: true,
  /** Automated voice calls to clients (Twilio voice). Never run with a real account. */
  voiceCalls: true,
} as const;

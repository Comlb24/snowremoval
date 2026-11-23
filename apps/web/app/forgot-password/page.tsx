import Link from 'next/link';
import { passwordResetAvailable } from '@snow/server';
import { AuthShell, GlassNotice } from '@/components/auth-shell';
import { glassInput, glassLabel, glassLink } from '@/components/glass';
import { COMING_SOON } from '@/lib/features';
import { forgotPasswordAction } from '../login/actions';
import { SubmitButton } from '../login/submit-button';

export const dynamic = 'force-dynamic';

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const { error, sent } = await searchParams;
  const available = passwordResetAvailable();
  const back = (
    <Link href="/login" className={glassLink}>
      ← Back to sign in
    </Link>
  );

  if (COMING_SOON.passwordReset) {
    return (
      <AuthShell
        title="Password reset (coming soon)"
        subtitle="You will soon be able to reset your password here. For now, ask the admin to reset it for you."
        footer={
          <Link href="/login" className={glassLink}>
            ← Back to sign in
          </Link>
        }
      >
        <p className="text-sm text-white/75">This feature is not available yet.</p>
      </AuthShell>
    );
  }

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle="If that email has an account, a reset link is on its way. It can take a minute." footer={back}>
        <GlassNotice tone="success">Open the link in the email to choose a new password. Check your spam folder if you do not see it.</GlassNotice>
        <Link href="/forgot-password" className={`text-sm ${glassLink}`}>
          Send it again
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot password?" subtitle="Enter your email. We will send you a link to choose a new password." footer={back}>
      {error && <GlassNotice tone="danger">{error}</GlassNotice>}
      {!available && <GlassNotice tone="info">Password reset emails are not set up on this server yet.</GlassNotice>}
      <form action={forgotPasswordAction} className="space-y-4">
        <label className="block">
          <span className={glassLabel}>Email</span>
          <input name="email" type="email" required autoFocus placeholder="you@example.com" className={glassInput} autoComplete="email" />
        </label>
        <div className="pt-1">
          <SubmitButton label="Send reset link" pendingLabel="Sending…" />
        </div>
      </form>
    </AuthShell>
  );
}

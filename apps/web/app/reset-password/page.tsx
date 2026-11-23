import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { glassLink } from '@/components/glass';
import { COMING_SOON } from '@/lib/features';
import { ResetForm } from './reset-form';

export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
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

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Use at least 8 characters."
      footer={
        <Link href="/login" className={glassLink}>
          ← Back to sign in
        </Link>
      }
    >
      <ResetForm />
    </AuthShell>
  );
}

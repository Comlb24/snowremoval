import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { glassLink } from '@/components/glass';
import { ResetForm } from './reset-form';

export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
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

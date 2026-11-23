'use client';
import { useFormStatus } from 'react-dom';
import { glassButton } from '@/components/glass';

/** Sign-in button that shows it is working, so a slow first sign-in never looks like "nothing happened". */
export function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={glassButton}>
      {pending && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {pending ? pendingLabel : label}
    </button>
  );
}

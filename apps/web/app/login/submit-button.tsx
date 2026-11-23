'use client';
import { useFormStatus } from 'react-dom';
import { btn } from '@/components/ui';

/** Sign-in button that shows it is working, so a slow first sign-in never looks like "nothing happened". */
export function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${btn()} w-full`}>
      {pending ? pendingLabel : label}
    </button>
  );
}

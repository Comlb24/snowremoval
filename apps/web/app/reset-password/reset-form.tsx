'use client';
import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { glassButton, glassInput, glassLabel, glassLink } from '@/components/glass';
import { resetPasswordAction, type ResetState } from '../login/actions';
import { SubmitButton } from '../login/submit-button';

type LinkState = { kind: 'loading' } | { kind: 'missing' } | { kind: 'expired' } | { kind: 'ready'; token: string };

const box = 'mb-5 rounded-xl border px-3.5 py-2.5 text-sm text-white';

/**
 * The reset email link lands here with a one-time token in the part of the URL after "#".
 * That part never reaches the server in the page request, so we read it here, remove it from the address bar,
 * and send it with the new password.
 */
export function ResetForm() {
  const [link, setLink] = useState<LinkState>({ kind: 'loading' });
  const [state, action] = useActionState<ResetState, FormData>(resetPasswordAction, { ok: false });

  // Read the link once: the address bar is cleaned after the first read, so a repeat run must reuse the result.
  const parsed = useRef<LinkState | null>(null);

  useEffect(() => {
    if (!parsed.current) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const token = params.get('access_token');
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
      parsed.current = params.get('error') || params.get('error_code') ? { kind: 'expired' } : token ? { kind: 'ready', token } : { kind: 'missing' };
    }
    setLink(parsed.current);
  }, []);

  if (state.ok) {
    return (
      <>
        <div role="status" className={`${box} border-emerald-200/50 bg-emerald-500/25`}>
          Your password is updated.
        </div>
        <Link href="/login?reset=1" className={glassButton}>
          Sign in
        </Link>
      </>
    );
  }

  if (link.kind === 'loading') return <p className="text-sm text-white/70">Checking your link…</p>;

  if (link.kind !== 'ready') {
    return (
      <>
        <div role="alert" className={`${box} border-rose-200/50 bg-rose-500/25`}>
          {link.kind === 'expired'
            ? 'This reset link has expired or was already used.'
            : 'Open this page from the link in your reset email.'}
        </div>
        <Link href="/forgot-password" className={glassButton}>
          Send a new link
        </Link>
      </>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <div role="alert" className={`${box} border-rose-200/50 bg-rose-500/25`}>
          {state.error}{' '}
          {/expired/i.test(state.error) && (
            <Link href="/forgot-password" className={glassLink}>
              Send a new link
            </Link>
          )}
        </div>
      )}
      <input type="hidden" name="token" value={link.token} />
      <label className="block">
        <span className={glassLabel}>New password</span>
        <input name="password" type="password" required minLength={8} autoFocus className={glassInput} autoComplete="new-password" />
      </label>
      <label className="block">
        <span className={glassLabel}>Type it again</span>
        <input name="confirm" type="password" required minLength={8} className={glassInput} autoComplete="new-password" />
      </label>
      <div className="pt-1">
        <SubmitButton label="Save new password" pendingLabel="Saving…" />
      </div>
    </form>
  );
}

import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError, ForbiddenError, log, requireRole, type SessionUser } from '@snow/server';
import { currentUser, type CurrentUser } from './session';

/** Wrap an API handler: resolves the user, enforces roles, and turns errors into clean JSON. */
export function api<T>(roles: SessionUser['role'][] | null, fn: (user: CurrentUser, req: Request, ctx: any) => Promise<T>) {
  return async (req: Request, ctx: any) => {
    try {
      const user = await currentUser();
      if (roles) requireRole(user, ...roles);
      const out = await fn(user as CurrentUser, req, ctx);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
  if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof ZodError) return NextResponse.json({ error: e.issues.map((i) => i.message).join('; ') }, { status: 400 });
  const msg = e instanceof Error ? e.message : String(e);
  // Database permission errors (RLS / function checks) become 403.
  if (/permission denied|not found on your active routes|Only drivers|Route not available|No shift/i.test(msg)) {
    return NextResponse.json({ error: 'You do not have access to this' }, { status: 403 });
  }
  log.error(`API error: ${msg}`);
  return NextResponse.json({ error: msg.length < 200 ? msg : 'Something went wrong' }, { status: 400 });
}

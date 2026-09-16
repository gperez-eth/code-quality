import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

/**
 * Next 16 renamed this convention from `middleware` to `proxy`; the function
 * has to be named `proxy` (or be the default export) or it is never called.
 *
 * This only keeps the session fresh. It is not where access is decided: a
 * cookie is spoofable, so the real checks live next to the data, in
 * `lib/session.ts`.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static assets; without a matcher this would also run on
  // CSS, JS and images.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};

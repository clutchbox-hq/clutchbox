import { getSessionCookie } from 'better-auth/cookies';
import { type NextRequest, NextResponse } from 'next/server';
import { canonicalAuthUrl } from './lib/canonical-auth';

const redirect = (target: URL) => {
  const response = NextResponse.redirect(target, 307);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
};

// Where the signed-in pages lived before /app. Installed extensions and old links still use these, so they redirect
// for good; the browser keeps the hash, which the overview follows to the right page.
export const moved: Record<string, string> = { '/account': '/app', '/computer': '/app/computer' };

// Every product page that sets or reads auth cookies: / (which routes on them without a landing page), sign-in, consent, the app, and the old
// addresses of its pages. Next.js reads an app's matcher only as a literal in its own proxy.ts, so each app writes it
// out, covering at least these.
export const productMatcher = [
  '/',
  '/sign-in',
  '/consent',
  '/app',
  '/app/:path*',
  '/account',
  '/computer',
  '/api/auth/oauth2/authorize',
];

// The app's proxy: the canonical origin first, then the moved pages, then /. With `landing`, the deployment serves its
// own landing page at / to everyone, and signed-in visitors open the app from its links. Without one, / routes by
// session cookie: to the app or to sign-in.
export function createProductProxy({ landing = false }: { landing?: boolean } = {}) {
  return function proxy(request: NextRequest) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return NextResponse.next();
    const target = canonicalAuthUrl(request.url, process.env.APP_ENV, process.env.BETTER_AUTH_URL);
    if (target) return redirect(target);
    const { pathname, search } = request.nextUrl;
    const page = moved[pathname];
    if (page) return NextResponse.redirect(new URL(`${page}${search}`, request.url), 308);
    if (pathname !== '/' || landing) return NextResponse.next();
    // Only the cookie's presence is checked here; the app validates the session and sends a stale one to /sign-in.
    return redirect(new URL(getSessionCookie(request) ? '/app' : '/sign-in', request.url));
  };
}

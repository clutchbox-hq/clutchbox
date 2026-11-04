import { createProductProxy } from '@clutchbox/web/proxy';

// No landing page: / opens the app for signed-in visitors and sign-in for the rest.
export const proxy = createProductProxy();

// The product's matcher (productMatcher in @clutchbox/web/proxy), written out because Next.js reads it only as
// a literal here.
export const config = {
  matcher: ['/', '/sign-in', '/consent', '/app', '/app/:path*', '/account', '/computer', '/api/auth/oauth2/authorize'],
};

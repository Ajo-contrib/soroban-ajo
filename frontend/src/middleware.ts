import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: [
    // Match all pathnames except for ones starting with:
    // - api (API routes)
    // - _next/static (static files)
    // - _next/image (image optimization files)
    // - files with extensions (e.g. .svg, .png, .ico, .txt, .xml, .json, .css, .js)
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};

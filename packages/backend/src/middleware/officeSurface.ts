import type { Request, Response, NextFunction } from 'express';
export const OFFICE_PUBLIC_PATHS = [
  '/office/taskpane.html',
  '/office/taskpane.js',
  '/office/style.css',
  '/office/icon.png',
  '/office/manifest.xml',
];
export function officeSurfaceHeaders(req: Request, res: Response, next: NextFunction) {
  const pane = OFFICE_PUBLIC_PATHS.includes(req.path);
  if (['GET', 'HEAD'].includes(req.method) && (pane || req.path === '/office-connect')) {
    res.removeHeader('X-Frame-Options');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "script-src 'self' https://appsforoffice.microsoft.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self' https://appsforoffice.microsoft.com",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        pane
          ? "frame-ancestors 'self' https://*.officeapps.live.com https://*.office.com https://*.cloud.microsoft https://*.sharepoint.com"
          : "frame-ancestors 'none'",
      ].join('; ')
    );
  }
  next();
}

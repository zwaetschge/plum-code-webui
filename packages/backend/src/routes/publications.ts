import { Router, type ErrorRequestHandler } from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { publicPublication } from '../services/assistant/publications.js';
export const PUBLICATION_CONTENT_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts; frame-ancestors 'self'";
const router = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), display-capture=()'
  );
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});
router.get('/:token/content', async (req, res, next) => {
  try {
    const value = await publicPublication(req.params.token);
    res.setHeader('Content-Security-Policy', PUBLICATION_CONTENT_CSP);
    res.type('html').send(value.html);
  } catch (error) {
    next(error);
  }
});
router.get('/:token', async (req, res, next) => {
  try {
    const value = await publicPublication(req.params.token);
    const title = value.title.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
    );
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
    res.setHeader('X-Frame-Options', 'DENY');
    res
      .type('html')
      .send(
        `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;font:16px system-ui;color:#141414;background:white}header{padding:12px 16px;border-bottom:1px solid #ddd}h1{margin:0;font-size:18px;overflow-wrap:anywhere}p{margin:4px 0 0;font-size:13px}iframe{border:0;width:100%;height:calc(100dvh - 86px);display:block}</style></head><body><header><h1>${title}</h1><p>Veröffentlichte Plum-Version · schreibgeschützt</p></header><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" src="/published/${req.params.token}/content" title="Veröffentlichter Inhalt"></iframe></body></html>`
      );
  } catch (error) {
    next(error);
  }
});
// Expected anonymous misses must not put a bearer publication URL into request-error logs.
const publicError: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = error instanceof AppError ? error.statusCode : 500;
  res.status(status).json({
    success: false,
    error: {
      code:
        status === 503
          ? 'PUBLICATION_DISABLED'
          : status === 404
            ? 'NOT_FOUND'
            : 'PUBLICATION_ERROR',
      message:
        status === 503
          ? 'Öffentliche Veröffentlichungen sind nicht aktiviert'
          : status === 404
            ? 'Veröffentlichung nicht gefunden'
            : 'Veröffentlichung konnte nicht geladen werden',
    },
  });
};
router.use(publicError);
export default router;

import logger from '../utils/logger.js';

export function errorHandler(err, req, res, next) {
  logger.error(err.stack || err.message);
  const status = err.status || err.response?.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const message =
    isProd && status >= 500
      ? 'Internal Server Error'
      : err.message || err.response?.data?.message || 'Internal Server Error';
  const payload = { message };
  if (!isProd) {
    if (err.diagnostics) payload.diagnostics = err.diagnostics;
    if (err.hint) payload.hint = err.hint;
    if (err.stack) payload.stack = err.stack;
  }
  res.status(status).json(payload);
}

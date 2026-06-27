import logger from '../utils/logger.js';

export function errorHandler(err, req, res, next) {
  logger.error(err.stack || err.message);
  const status = err.status || err.response?.status || 500;
  const message = err.message || err.response?.data?.message || 'Internal Server Error';
  res.status(status).json({
    message,
    ...(err.diagnostics && { diagnostics: err.diagnostics }),
    ...(err.hint && { hint: err.hint }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

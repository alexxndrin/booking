const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function errorResponse(code, message) {
  return {
    code,
    message,
    traceId: crypto.randomUUID(),
  };
}

function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json(
      errorResponse('UNAUTHORIZED', 'Нет действительного JWT. Выполните вход.')
    );
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const id = payload.id || payload.sub;
    const role = payload.role;

    if (!id || !role) {
      return res.status(401).json(
        errorResponse('UNAUTHORIZED', 'Нет действительного JWT. Выполните вход.')
      );
    }

    req.user = { id, role };
    return next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError'
        ? 'Срок действия JWT истёк. Выполните вход снова.'
        : 'Нет действительного JWT. Выполните вход.';

    return res.status(401).json(errorResponse('UNAUTHORIZED', message));
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json(
      errorResponse('UNAUTHORIZED', 'Нет действительного JWT. Выполните вход.')
    );
  }

  if (req.user.role !== 'администратор') {
    return res.status(403).json(
      errorResponse('FORBIDDEN', 'Недостаточно прав для административной функции.')
    );
  }

  return next();
}

module.exports = {
  verifyToken,
  requireAdmin,
};
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

function sendError(res, status, code, message) {
  return res.status(status).json({
    code,
    message,
    traceId: crypto.randomUUID(),
  });
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    login: row.login,
    role: row.role,
  };
}

async function register(req, res) {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const login = typeof req.body?.login === 'string' ? req.body.login.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (name.length < 2 || name.length > 100) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Имя должно содержать от 2 до 100 символов.');
  }
  if (login.length < 3 || login.length > 64) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Логин должен содержать от 3 до 64 символов.');
  }
  if (password.length < 8) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Пароль должен содержать не менее 8 символов.');
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, login, password_hash, role)
       VALUES ($1, $2, $3, 'пользователь')
       RETURNING id, name, login, role`,
      [name, login, passwordHash]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    return res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    if (err.code === '23505') {
      return sendError(res, 409, 'CONFLICT', 'Пользователь с таким логином уже существует.');
    }
    const traceId = crypto.randomUUID();
    console.error(traceId, err.message);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера.',
      traceId,
    });
  }
}

async function login(req, res) {
  const login = typeof req.body?.login === 'string' ? req.body.login.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!login || !password) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Укажите логин и пароль.');
  }

  try {
    const result = await pool.query(
      `SELECT id, name, login, password_hash, role
       FROM users
       WHERE login = $1`,
      [login]
    );

    const user = result.rows[0];
    const passwordOk = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!user || !passwordOk) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Неверный логин или пароль.');
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    return res.json({ token, user: publicUser(user) });
  } catch (err) {
    const traceId = crypto.randomUUID();
    console.error(traceId, err.message);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Внутренняя ошибка сервера.',
      traceId,
    });
  }
}

module.exports = {
  register,
  login,
};
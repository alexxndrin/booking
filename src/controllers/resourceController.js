const crypto = require('crypto');
const pool = require('../config/db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sendError(res, status, code, message) {
  return res.status(status).json({
    code,
    message,
    traceId: crypto.randomUUID(),
  });
}

function escapeIlike(value) {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

async function listResources(req, res) {
  const rawSearch = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  try {
    let result;
    if (rawSearch) {
      result = await pool.query(
        `SELECT id, name, description, location, is_active
         FROM resources
         WHERE is_active = TRUE
           AND name ILIKE $1 ESCAPE '\\'
         ORDER BY name`,
        [`%${escapeIlike(rawSearch)}%`]
      );
    } else {
      result = await pool.query(
        `SELECT id, name, description, location, is_active
         FROM resources
         WHERE is_active = TRUE
         ORDER BY name`
      );
    }

    return res.json({ items: result.rows });
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

async function getAvailability(req, res) {
  const { id } = req.params;
  const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';

  if (!UUID_RE.test(id)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Некорректный идентификатор ресурса.');
  }
  if (!DATE_RE.test(date)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Укажите дату в формате YYYY-MM-DD.');
  }

  const isAdmin = req.user.role === 'администратор';

  try {
    const resource = await pool.query(
      `SELECT id FROM resources WHERE id = $1`,
      [id]
    );
    if (resource.rowCount === 0) {
      return sendError(res, 404, 'NOT_FOUND', 'Ресурс не найден.');
    }

    // Дата трактуется как календарный день по Москве; в БД время хранится в UTC
    const boundsSql = `
      (($1::date)::timestamp AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'UTC'
    `;
    const boundsEndSql = `
      ((($1::date + 1)::timestamp) AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'UTC'
    `;

    let result;
    if (isAdmin) {
      result = await pool.query(
        `SELECT
           b.id,
           to_char(b.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time,
           to_char(b.end_time,   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_time,
           b.purpose,
           b.owner_id,
           u.name AS owner_name,
           u.login AS owner_login
         FROM bookings b
         JOIN users u ON u.id = b.owner_id
         WHERE b.resource_id = $2
           AND b.status = 'Активно'
           AND b.start_time < ${boundsEndSql}
           AND b.end_time > ${boundsSql}
         ORDER BY b.start_time`,
        [date, id]
      );
    } else {
      result = await pool.query(
        `SELECT
           to_char(start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time,
           to_char(end_time,   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_time
         FROM bookings
         WHERE resource_id = $2
           AND status = 'Активно'
           AND start_time < ${boundsEndSql}
           AND end_time > ${boundsSql}
         ORDER BY start_time`,
        [date, id]
      );
    }

    return res.json({
      resourceId: id,
      date,
      timezone: 'Europe/Moscow',
      intervals: result.rows,
    });
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
  listResources,
  getAvailability,
};
const crypto = require('crypto');
const pool = require('../config/db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const MIN_DURATION_MIN = 30;
const MAX_DURATION_MIN = 4 * 60;
const MAX_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
const WORK_START_MIN = 8 * 60;
const WORK_END_MIN = 22 * 60;

const BOOKING_RETURNING = `
  id,
  resource_id,
  owner_id,
  to_char(start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time,
  to_char(end_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_time,
  purpose,
  status,
  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
  CASE WHEN cancelled_at IS NULL THEN NULL
       ELSE to_char(cancelled_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS cancelled_at,
  cancelled_by,
  cancel_reason
`;

function sendError(res, status, code, message, traceId = crypto.randomUUID()) {
  return res.status(status).json({ code, message, traceId });
}

function mapBooking(row) {
  return {
    id: row.id,
    resourceId: row.resource_id,
    ownerId: row.owner_id,
    startTime: row.start_time,
    endTime: row.end_time,
    purpose: row.purpose,
    status: row.status,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    cancelReason: row.cancel_reason,
  };
}

function utcTimestamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function mskWall(date) {
  const shifted = new Date(date.getTime() + MSK_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    ms: shifted.getUTCMilliseconds(),
  };
}

function fingerprintOf({ resourceId, startTime, endTime, purpose }) {
  const canonical = JSON.stringify({
    resourceId,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    purpose,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function validateInterval(startTime, endTime) {
  const start = mskWall(startTime);
  const end = mskWall(endTime);

  if (start.second !== 0 || start.ms !== 0 || end.second !== 0 || end.ms !== 0) {
    return 'Время должно быть кратно 30 минутам.';
  }
  if (start.minute % 30 !== 0 || end.minute % 30 !== 0) {
    return 'Время должно быть кратно 30 минутам.';
  }
  if (endTime <= startTime) {
    return 'Окончание должно быть позже начала.';
  }

  const sameDay =
    start.year === end.year && start.month === end.month && start.day === end.day;
  if (!sameDay) {
    return 'Бронирование должно целиком помещаться в один рабочий день.';
  }

  const startMin = start.hour * 60 + start.minute;
  const endMin = end.hour * 60 + end.minute;
  if (startMin < WORK_START_MIN || endMin > WORK_END_MIN) {
    return 'Ресурс доступен ежедневно с 08:00 до 22:00 по московскому времени.';
  }

  const durationMin = (endTime.getTime() - startTime.getTime()) / 60000;
  if (durationMin < MIN_DURATION_MIN || durationMin > MAX_DURATION_MIN) {
    return 'Длительность бронирования — от 30 минут до 4 часов.';
  }

  const now = Date.now();
  if (startTime.getTime() <= now) {
    return 'Начало бронирования не может находиться в прошлом.';
  }
  if (startTime.getTime() > now + MAX_AHEAD_MS) {
    return 'Бронирование возможно не позднее чем через 30 суток.';
  }

  return null;
}

async function findIdempotent(userId, key) {
  const result = await pool.query(
    `SELECT
       ik.request_fingerprint,
       b.id,
       b.resource_id,
       b.owner_id,
       to_char(b.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time,
       to_char(b.end_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_time,
       b.purpose,
       b.status,
       to_char(b.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
       CASE WHEN b.cancelled_at IS NULL THEN NULL
            ELSE to_char(b.cancelled_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS cancelled_at,
       b.cancelled_by,
       b.cancel_reason
     FROM idempotency_keys ik
     JOIN bookings b ON b.id = ik.booking_id
     WHERE ik.user_id = $1 AND ik.key = $2`,
    [userId, key]
  );
  return result.rows[0] || null;
}

async function createBooking(req, res) {
  const traceId = crypto.randomUUID();
  const key = typeof req.headers['idempotency-key'] === 'string'
    ? req.headers['idempotency-key'].trim()
    : '';

  if (key.length < 8 || key.length > 128) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'Укажите заголовок Idempotency-Key длиной от 8 до 128 символов.',
      traceId
    );
  }

  const resourceId = req.body?.resourceId || req.body?.resource_id;
  const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose.trim() : '';
  const startRaw = req.body?.startTime || req.body?.start_time;
  const endRaw = req.body?.endTime || req.body?.end_time;

  if (!UUID_RE.test(String(resourceId || ''))) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Некорректный идентификатор ресурса.', traceId);
  }
  if (purpose.length < 5 || purpose.length > 300) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'Цель бронирования должна содержать от 5 до 300 символов.',
      traceId
    );
  }

  const startTime = new Date(startRaw);
  const endTime = new Date(endRaw);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'Укажите начало и окончание в формате ISO 8601 со смещением часового пояса.',
      traceId
    );
  }

  const intervalError = validateInterval(startTime, endTime);
  if (intervalError) {
    return sendError(res, 400, 'VALIDATION_ERROR', intervalError, traceId);
  }

  const fingerprint = fingerprintOf({ resourceId, startTime, endTime, purpose });
  const startUtc = utcTimestamp(startTime);
  const endUtc = utcTimestamp(endTime);

  try {
    const existing = await findIdempotent(req.user.id, key);
    if (existing) {
      if (existing.request_fingerprint !== fingerprint) {
        return sendError(
          res,
          409,
          'CONFLICT',
          'Ключ повторного запроса уже использован с другими данными.',
          traceId
        );
      }
      return res.status(200).json({ booking: mapBooking(existing), replayed: true });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Блокировка строки ресурса: конкурентные создания и отключение ждут этой блокировки
      const resource = await client.query(
        `SELECT id, is_active FROM resources WHERE id = $1 FOR UPDATE`,
        [resourceId]
      );
      if (resource.rowCount === 0) {
        await client.query('ROLLBACK');
        return sendError(res, 404, 'NOT_FOUND', 'Ресурс не найден.', traceId);
      }
      if (!resource.rows[0].is_active) {
        await client.query('ROLLBACK');
        return sendError(
          res,
          409,
          'CONFLICT',
          'Ресурс отключён, новые бронирования недоступны.',
          traceId
        );
      }

      const overlap = await client.query(
        `SELECT id FROM bookings
         WHERE resource_id = $1
           AND status = 'Активно'
           AND start_time < $3
           AND end_time > $2
         LIMIT 1`,
        [resourceId, startUtc, endUtc]
      );
      if (overlap.rowCount > 0) {
        await client.query('ROLLBACK');
        const replay = await findIdempotent(req.user.id, key);
        if (replay && replay.request_fingerprint === fingerprint) {
          return res.status(200).json({ booking: mapBooking(replay), replayed: true });
        }
        return sendError(
          res,
          409,
          'CONFLICT',
          'Ресурс уже занят в выбранное время.',
          traceId
        );
      }

      const inserted = await client.query(
        `INSERT INTO bookings (
           resource_id, owner_id, start_time, end_time, purpose, status
         ) VALUES ($1, $2, $3, $4, $5, 'Активно')
         RETURNING ${BOOKING_RETURNING}`,
        [resourceId, req.user.id, startUtc, endUtc, purpose]
      );
      const booking = inserted.rows[0];

      await client.query(
        `INSERT INTO idempotency_keys (user_id, key, request_fingerprint, booking_id)
         VALUES ($1, $2, $3, $4)`,
        [req.user.id, key, fingerprint, booking.id]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, action, object_type, object_id, result, request_id)
         VALUES ($1, 'booking.create', 'booking', $2, 'успех', $3)`,
        [req.user.id, booking.id, traceId]
      );

      await client.query('COMMIT');
      return res.status(201).json({ booking: mapBooking(booking), replayed: false });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* транзакция уже завершена */
      }

      if (err.code === '23P01') {
        const replay = await findIdempotent(req.user.id, key);
        if (replay && replay.request_fingerprint === fingerprint) {
          return res.status(200).json({ booking: mapBooking(replay), replayed: true });
        }
        return sendError(
          res,
          409,
          'CONFLICT',
          'Ресурс уже занят в выбранное время.',
          traceId
        );
      }

      if (err.code === '23505') {
        const replay = await findIdempotent(req.user.id, key);
        if (replay && replay.request_fingerprint === fingerprint) {
          return res.status(200).json({ booking: mapBooking(replay), replayed: true });
        }
        if (replay) {
          return sendError(
            res,
            409,
            'CONFLICT',
            'Ключ повторного запроса уже использован с другими данными.',
            traceId
          );
        }
      }

      console.error(traceId, err.message);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера.', traceId);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(traceId, err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера.', traceId);
  }
}

async function cancelBooking(req, res) {
  const traceId = crypto.randomUUID();
  const { id } = req.params;

  if (!UUID_RE.test(id)) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'Некорректный идентификатор бронирования.',
      traceId
    );
  }

  const isAdmin = req.user.role === 'администратор';
  const reasonRaw = req.body?.cancelReason ?? req.body?.cancel_reason;
  const cancelReason = typeof reasonRaw === 'string' ? reasonRaw.trim() : '';

  if (isAdmin && cancelReason.length === 0) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'Администратор должен указать причину отмены.',
      traceId
    );
  }
  if (cancelReason.length > 300) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'Причина отмены не должна превышать 300 символов.',
      traceId
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT id, owner_id, status,
              start_time > (now() AT TIME ZONE 'utc') AS is_future
       FROM bookings
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (found.rowCount === 0) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'NOT_FOUND', 'Бронирование не найдено.', traceId);
    }

    const row = found.rows[0];

    // Чужую запись обычному пользователю не раскрываем
    if (!isAdmin && row.owner_id !== req.user.id) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'NOT_FOUND', 'Бронирование не найдено.', traceId);
    }

    // Повторная отмена не меняет состояние и не пишет второй успешный аудит
    if (row.status === 'Отменено') {
      const current = await client.query(
        `SELECT ${BOOKING_RETURNING} FROM bookings WHERE id = $1`,
        [id]
      );
      await client.query('COMMIT');
      return res.json({ booking: mapBooking(current.rows[0]), alreadyCancelled: true });
    }

    if (!row.is_future) {
      await client.query('ROLLBACK');
      return sendError(
        res,
        409,
        'CONFLICT',
        'Нельзя отменить начавшуюся или завершённую запись.',
        traceId
      );
    }

    const updated = await client.query(
      `UPDATE bookings
       SET status = 'Отменено',
           cancelled_at = (now() AT TIME ZONE 'utc'),
           cancelled_by = $2,
           cancel_reason = $3
       WHERE id = $1
       RETURNING ${BOOKING_RETURNING}`,
      [id, req.user.id, isAdmin ? cancelReason : (cancelReason || null)]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, object_type, object_id, result, request_id)
       VALUES ($1, 'booking.cancel', 'booking', $2, 'успех', $3)`,
      [req.user.id, id, traceId]
    );

    await client.query('COMMIT');
    return res.json({ booking: mapBooking(updated.rows[0]), alreadyCancelled: false });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* транзакция уже завершена */
    }
    console.error(traceId, err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера.', traceId);
  } finally {
    client.release();
  }
}

async function listMyBookings(req, res) {
  const result = await pool.query(
    `SELECT b.id, r.name AS resource_name, b.purpose, b.status,
            to_char(b.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time,
            to_char(b.end_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_time
     FROM bookings b
     JOIN resources r ON r.id = b.resource_id
     WHERE b.owner_id = $1
     ORDER BY b.start_time DESC`,
    [req.user.id]
  );
  res.json({ items: result.rows });
}

module.exports = {
  createBooking,
  cancelBooking,
  listMyBookings,
};


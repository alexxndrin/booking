const crypto = require('crypto');
const pool = require('../config/db');

function sendError(res, status, code, message) {
  return res.status(status).json({
    code,
    message,
    traceId: crypto.randomUUID(),
  });
}

async function listAllBookings(req, res) {
  try {
    const result = await pool.query(
      `SELECT
         b.id,
         b.resource_id,
         r.name AS resource_name,
         b.owner_id,
         u.name AS owner_name,
         u.login AS owner_login,
         to_char(b.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time,
         to_char(b.end_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_time,
         b.purpose,
         b.status,
         to_char(b.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
         CASE WHEN b.cancelled_at IS NULL THEN NULL
              ELSE to_char(b.cancelled_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS cancelled_at,
         b.cancelled_by,
         b.cancel_reason
       FROM bookings b
       JOIN resources r ON r.id = b.resource_id
       JOIN users u ON u.id = b.owner_id
       ORDER BY b.start_time DESC`
    );
    return res.json({ items: result.rows });
  } catch (err) {
    const traceId = crypto.randomUUID();
    console.error(traceId, err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера.');
  }
}

async function listAuditLogs(req, res) {
  try {
    const result = await pool.query(
      `SELECT
         a.id,
         to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
         a.actor_id,
         u.name AS actor_name,
         u.login AS actor_login,
         a.action,
         a.object_type,
         a.object_id,
         a.result,
         a.request_id
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.created_at DESC`
    );
    return res.json({ items: result.rows });
  } catch (err) {
    const traceId = crypto.randomUUID();
    console.error(traceId, err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера.');
  }
}

module.exports = {
  listAllBookings,
  listAuditLogs,
};
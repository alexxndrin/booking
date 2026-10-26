const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { listAllBookings, listAuditLogs } = require('../controllers/adminController');

const router = express.Router();

router.use(verifyToken, requireAdmin);

router.get('/bookings', listAllBookings);
router.get('/audit', listAuditLogs);

module.exports = router;
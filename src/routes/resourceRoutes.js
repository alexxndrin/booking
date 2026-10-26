const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { listResources, getAvailability } = require('../controllers/resourceController');

const router = express.Router();

router.get('/', verifyToken, listResources);
router.get('/:id/availability', verifyToken, getAvailability);

module.exports = router;
const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { listResources, getResourceById, getAvailability } = require('../controllers/resourceController');

const router = express.Router();

router.get('/', listResources);
router.get('/:id', getResourceById);
router.get('/:id/availability', getAvailability);

module.exports = router;

const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { createBooking, cancelBooking, listMyBookings } = require('../controllers/bookingController');

const router = express.Router();

router.post('/', verifyToken, createBooking);
router.get('/my', verifyToken, listMyBookings); 
router.post('/:id/cancel', verifyToken, cancelBooking);

module.exports = router;

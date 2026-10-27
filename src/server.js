const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const crypto = require('crypto');
const express = require('express');
const pool = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const resourceRoutes = require('./routes/resourceRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Разбор JSON в теле запросов
app.use(express.json());

// Раздача фронтенда из папки public
app.use(express.static(path.join(__dirname, '../public')));


app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'UP' });
});

app.get('/health/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.status(200).json({ status: 'READY' });
  } catch (err) {
    console.error('health/ready', err.message);
    return res.status(503).json({
      status: 'DOWN',
      code: 'SERVICE_UNAVAILABLE',
      message: 'Сервис не готов к обработке запросов.',
      traceId: crypto.randomUUID(),
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin', adminRoutes);

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
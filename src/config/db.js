const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { Pool } = require('pg');

// Пул соединений: параметры берутся из .env
const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
});

pool.on('error', (err) => {
  console.error('Неожиданная ошибка простаивающего клиента PostgreSQL:', err.message);
});

module.exports = pool;
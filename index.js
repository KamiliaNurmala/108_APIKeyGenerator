const express = require('express')
const path = require('path')
const crypto = require('crypto')
const mysql = require('mysql2/promise')
const app = express()
const port = 3000

// Konfigurasi koneksi MySQL
const dbConfig = {
  host: 'localhost',
  user: 'root',           // Ganti dengan username MySQL Anda
  password: '12HJQmbxttw',           // Ganti dengan password MySQL Anda
  database: 'api_key_db',
  port: 3309,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}
// Buat connection pool
const pool = mysql.createPool(dbConfig)

// Middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static('public'))

// --- ROUTES ---

// 1. Serve HTML Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// 2. USER REGISTER (Generate Key & Save User)
app.post('/register', async (req, res) => {
  let connection;
  try {
      const { firstname, lastname, email } = req.body;
      
      // Generate API Key
      const timestamp = Date.now();
      const random = crypto.randomBytes(16).toString('hex');
      const apiKey = `sk-umy-${timestamp}-${random}`;

      connection = await pool.getConnection();
      await connection.beginTransaction();

      // A. Save API Key first
      const [keyResult] = await connection.query(
          'INSERT INTO api_keys (api_key, is_active, out_of_date) VALUES (?, ?, ?)',
          [apiKey, true, false]
      );
      const keyId = keyResult.insertId;

      // B. Save User
      await connection.query(
          'INSERT INTO users (firstname, lastname, email, api_key_id) VALUES (?, ?, ?, ?)',
          [firstname, lastname, email, keyId]
      );

      await connection.commit();
      res.json({ success: true, apiKey: apiKey, message: 'User registered successfully!' });

  } catch (error) {
      if (connection) await connection.rollback();
      console.error(error);
      res.status(500).json({ success: false, message: error.message });
  } finally {
      if (connection) connection.release();
  }
});
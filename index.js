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

// 3. ADMIN LOGIN (Plain Text Check)
app.post('/admin/login', async (req, res) => {
  try {
      const { email, password } = req.body;
      const connection = await pool.getConnection();
      
      // Simple SELECT query
      const [rows] = await connection.query(
          'SELECT * FROM admin WHERE email = ? AND password = ?', 
          [email, password]
      );
      connection.release();

      if (rows.length > 0) {
          res.json({ success: true, message: 'Login successful' });
      } else {
          res.status(401).json({ success: false, message: 'Wrong email or password' });
      }
  } catch (error) {
      res.status(500).json({ success: false, message: error.message });
  }
});

// 4. DASHBOARD DATA
app.get('/api/users', async (req, res) => {
  try {
      const connection = await pool.getConnection();
      const sql = `
          SELECT u.id, u.firstname, u.lastname, u.email, k.api_key, k.out_of_date 
          FROM users u 
          LEFT JOIN api_keys k ON u.api_key_id = k.id
      `;
      const [rows] = await connection.query(sql);
      connection.release();
      res.json(rows);
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});

// 5. DELETE USER
app.delete('/api/users/:id', async (req, res) => {
  try {
      const userId = req.params.id;
      const connection = await pool.getConnection();
      await connection.query('DELETE FROM users WHERE id = ?', [userId]);
      connection.release();
      res.json({ success: true });
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});
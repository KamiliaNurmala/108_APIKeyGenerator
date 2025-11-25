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

// --- MIDDLEWARE HASHING (Custom tanpa bcrypt) ---
// Fungsi helper untuk hash password
const hashPassword = (password) => {
    return crypto.createHash('sha256').update(password).digest('hex');
};

// Middleware yang otomatis men-hash password jika ada di request body
const hashPasswordMiddleware = (req, res, next) => {
    if (req.body.password) {
        req.body.password = hashPassword(req.body.password);
    }
    next();
};

// --- ROUTES ---

// 1. Serve HTML Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin_register.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// 2. USER REGISTER (Save User & Key)
app.post('/register', async (req, res) => {
    let connection;
    try {
        const { firstname, lastname, email, apiKey } = req.body;
        
        connection = await pool.getConnection();

        // --- VALIDASI DUPLIKASI USER ---
        // Cek apakah email sudah ada
        const [existingEmail] = await connection.query(
            'SELECT id FROM users WHERE email = ?', 
            [email]
        );
        if (existingEmail.length > 0) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Email sudah terdaftar!' });
        }

        // Cek apakah kombinasi Nama Depan & Nama Belakang sudah ada
        const [existingName] = await connection.query(
            'SELECT id FROM users WHERE firstname = ? AND lastname = ?', 
            [firstname, lastname]
        );
        if (existingName.length > 0) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Nama User (Depan & Belakang) sudah terdaftar!' });
        }
        // -------------------------------

        // Fallback jika frontend tidak mengirim key
        const finalApiKey = apiKey || `sk-umy-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;

        await connection.beginTransaction();

        // Simpan API Key
        const [keyResult] = await connection.query(
            'INSERT INTO api_keys (api_key, is_active, out_of_date) VALUES (?, ?, ?)',
            [finalApiKey, true, false]
        );
        const keyId = keyResult.insertId;

        // Simpan User
        await connection.query(
            'INSERT INTO users (firstname, lastname, email, api_key_id) VALUES (?, ?, ?, ?)',
            [firstname, lastname, email, keyId]
        );

        await connection.commit();
        res.json({ success: true, apiKey: finalApiKey, message: 'User registered successfully!' });

    } catch (error) {
        if (connection) await connection.rollback();
        // Tangkap error duplicate entry database (jaga-jaga)
        if (error.code === 'ER_DUP_ENTRY') {
             res.status(400).json({ success: false, message: 'Data duplikat terdeteksi di database.' });
        } else {
             res.status(500).json({ success: false, message: error.message });
        }
    } finally {
        if (connection) connection.release();
    }
});

// 3. ADMIN REGISTER (Pakai Middleware Hash!)
app.post('/admin/register', hashPasswordMiddleware, async (req, res) => {
    let connection;
    try {
        const { email, password } = req.body;
        
        connection = await pool.getConnection();

        // --- VALIDASI DUPLIKASI ADMIN ---
        const [existingAdmin] = await connection.query(
            'SELECT id FROM admin WHERE email = ?', 
            [email]
        );
        
        if (existingAdmin.length > 0) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Email Admin sudah digunakan!' });
        }
        // --------------------------------

        await connection.query('INSERT INTO admin (email, password) VALUES (?, ?)', [email, password]);
        connection.release(); // Jangan lupa release connection manual karena tidak pakai try-finally block yang complex di sini (atau bisa disamakan strukturnya)
        
        res.json({ success: true, message: 'Admin created successfully' });
    } catch (error) {
        if(connection) connection.release();
        res.status(500).json({ success: false, message: error.message });
    }
});

// 4. ADMIN LOGIN (Pakai Middleware Hash juga!)
app.post('/admin/login', hashPasswordMiddleware, async (req, res) => {
    try {
        const { email, password } = req.body; // Password yang masuk sini sudah di-hash
        const connection = await pool.getConnection();
        
        // Bandingkan hash di database dengan hash inputan user
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

// 5. DASHBOARD DATA
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

// 6. DELETE USER (FIXED)
app.delete('/api/users/:id', async (req, res) => {
    let connection;
    try {
        const userId = req.params.id;
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.query(
            'SELECT api_key_id FROM users WHERE id = ?',
            [userId]
        );
        if (rows.length === 0) {
            connection.release();
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const apiKeyId = rows[0].api_key_id;

        if (apiKeyId) {
            await connection.query(
                'UPDATE api_keys SET is_active = 0, out_of_date = 1 WHERE id = ?',
                [apiKeyId]
            );
        }

        await connection.query('DELETE FROM users WHERE id = ?', [userId]);

        await connection.commit();
        res.json({ success: true, message: 'User deleted, API key ditandai out_of_date' });
    } catch (error) {
        if (connection) await connection.rollback();
        res.status(500).json({ success: false, message: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
});
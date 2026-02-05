const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// REGISTER
router.post('/register', async (req, res) => {
  try {
    const { email, password, full_name, phone } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (email, password_hash, full_name, phone) VALUES ($1,$2,$3,$4) RETURNING id',
      [email, hashed, full_name, phone]
    );

    res.json({ success: true, userId: result.rows[0].id });
  } catch (err) {
  console.error("REGISTER SQL ERROR:", err.message);
  console.error("FULL ERROR:", err);
  console.log("req.body:", req.body);
  return res.status(500).json({ error: err.message });
}
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ success: true, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;

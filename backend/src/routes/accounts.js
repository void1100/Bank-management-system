const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Auth middleware
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token provided" });

  const token = header.split(" ")[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// OPEN ACCOUNT
router.post('/open', auth, async (req, res) => {
  try {
    const { account_type } = req.body;

    if (!account_type)
      return res.status(400).json({ error: "account_type is required" });

    const accountNumber = "AC" + Math.floor(1000000000 + Math.random() * 9000000000);

    const result = await pool.query(
      `INSERT INTO accounts (user_id, account_number, account_type)
       VALUES ($1, $2, $3) RETURNING id, account_number`,
      [req.user.id, accountNumber, account_type]
    );

    res.json({ success: true, account: result.rows[0] });
  } catch (err) {
    console.error("Account open error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

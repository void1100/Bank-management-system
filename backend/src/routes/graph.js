const express = require("express");
const router = express.Router();
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Auth middleware
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token" });

  const token = header.split(" ")[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/**
 * 📊 DAILY AGGREGATION — GREAT FOR LINE & BAR GRAPHS
 * GET /api/graph/daily/:accountId
 * Returns deposit, withdraw, net totals grouped by date
 */
router.get("/daily/:accountId", auth, async (req, res) => {
  const { accountId } = req.params;

  // verify ownership
  const acc = await pool.query(
    `SELECT * FROM accounts WHERE id=$1 AND user_id=$2`,
    [accountId, req.user.id]
  );

  if (acc.rows.length === 0) {
    return res.status(403).json({ error: "Unauthorized account access" });
  }

  const data = await pool.query(
    `
    SELECT
      DATE(created_at) AS date,
      SUM(CASE WHEN type='deposit' THEN amount ELSE 0 END) AS deposits,
      SUM(CASE WHEN type='withdraw' THEN amount ELSE 0 END) AS withdrawals,
      SUM(CASE WHEN type='transfer-in' THEN amount ELSE 0 END) AS transfer_in,
      SUM(CASE WHEN type='transfer-out' THEN amount ELSE 0 END) AS transfer_out,
      SUM(amount) AS total
    FROM transactions
    WHERE account_id = $1
    GROUP BY DATE(created_at)
    ORDER BY DATE(created_at)
    `,
    [accountId]
  );

  res.json({
    success: true,
    accountId,
    days: data.rows.length,
    chart: data.rows,
  });
});


/**
 * 📈 BALANCE TREND — PERFECT FOR LINE CHART
 * GET /api/graph/balance/:accountId
 * Computes running balance over time
 */
router.get("/balance/:accountId", auth, async (req, res) => {
  const { accountId } = req.params;

  const acc = await pool.query(
    `SELECT * FROM accounts WHERE id=$1 AND user_id=$2`,
    [accountId, req.user.id]
  );
  if (acc.rows.length === 0) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const tx = await pool.query(
    `
    SELECT type, amount, created_at
    FROM transactions
    WHERE account_id = $1
    ORDER BY created_at ASC
    `,
    [accountId]
  );

  let balance = 0;
  let points = [];

  tx.rows.forEach((t) => {
    if (t.type === "deposit" || t.type === "transfer-in") {
      balance += Number(t.amount);
    } else if (t.type === "withdraw" || t.type === "transfer-out") {
      balance -= Number(t.amount);
    }

    points.push({
      x: t.created_at,
      y: balance,
    });
  });

  res.json({ success: true, accountId, points });
});


/**
 * 🧩 PIE CHART DATA — TRANSACTION TYPE SPLIT
 * GET /api/graph/types/:accountId
 */
router.get("/types/:accountId", auth, async (req, res) => {
  const { accountId } = req.params;

  const acc = await pool.query(
    `SELECT * FROM accounts WHERE id=$1 AND user_id=$2`,
    [accountId, req.user.id]
  );
  if (acc.rows.length === 0) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const data = await pool.query(
    `
    SELECT type, COUNT(*) AS count, SUM(amount) AS total
    FROM transactions
    WHERE account_id=$1
    GROUP BY type
    `,
    [accountId]
  );

  res.json({
    success: true,
    accountId,
    distribution: data.rows,
  });
});

module.exports = router;

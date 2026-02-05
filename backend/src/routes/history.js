const express = require("express");
const router = express.Router();
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// AUTH middleware
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
 * 📌 GET /api/history/:accountId
 * Returns full transaction history (sorted)
 */
router.get("/:accountId", auth, async (req, res) => {
  const { accountId } = req.params;

  try {
    // Check account ownership
    const accCheck = await pool.query(
      `SELECT * FROM accounts WHERE id=$1 AND user_id=$2`,
      [accountId, req.user.id]
    );

    if (accCheck.rows.length === 0) {
      return res.status(403).json({ error: "Unauthorized account access" });
    }

    const history = await pool.query(
      `SELECT id, type, amount, counterparty, created_at
       FROM transactions
       WHERE account_id=$1
       ORDER BY created_at DESC`,
      [accountId]
    );

    res.json({
      account_id: accountId,
      count: history.rows.length,
      transactions: history.rows,
    });

  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ error: "Failed to load transaction history" });
  }
});


/**
 * 📊 GET /api/history/chart/:accountId
 * Returns daily aggregated totals for charts
 */
router.get("/chart/:accountId", auth, async (req, res) => {
  const { accountId } = req.params;

  try {
    // Ownership check
    const accCheck = await pool.query(
      `SELECT * FROM accounts WHERE id=$1 AND user_id=$2`,
      [accountId, req.user.id]
    );

    if (accCheck.rows.length === 0) {
      return res.status(403).json({ error: "Unauthorized account access" });
    }

    const data = await pool.query(
      `
      SELECT 
        DATE(created_at) AS date,
        SUM(CASE WHEN type='deposit' THEN amount ELSE 0 END) AS total_deposit,
        SUM(CASE WHEN type='withdraw' THEN amount ELSE 0 END) AS total_withdraw,
        SUM(amount) AS total_amount
      FROM transactions
      WHERE account_id=$1
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
      `,
      [accountId]
    );

    res.json({
      account_id: accountId,
      days: data.rows.length,
      chart: data.rows,
    });

  } catch (err) {
    console.error("Chart error:", err);
    res.status(500).json({ error: "Failed to load chart data" });
  }
});

module.exports = router;

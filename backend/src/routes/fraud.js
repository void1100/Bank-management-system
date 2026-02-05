const express = require("express");
const router = express.Router();
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 🔐 AUTH (AUTHENTICATION ONLY)
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = header.split(" ")[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/**
 * GET fraud alerts by account ID (URL based)
 */
router.get("/:accountId", auth, async (req, res) => {
  const { accountId } = req.params;

  // Basic UUID sanity check (important)
  if (!accountId || accountId.length !== 36) {
    return res.status(400).json({ error: "Invalid account ID" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        event_id,
        reason,
        severity,
        created_at
      FROM fraud_alerts
      WHERE account_id = $1
      ORDER BY created_at DESC
      Limit 3
      `,
      [accountId]
    );

    res.json({
      count: rows.length,
      alerts: rows,
    });
  } catch (err) {
    console.error("Fraud alert fetch error:", err);
    res.status(500).json({ error: "Failed to fetch fraud alerts" });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const auth = require('./auth'); // Optional: use if you want protected dashboard access

module.exports = function (pool) {

  // GET /api/otp/dashboard
  router.get('/dashboard', async (req, res) => {
    const client = await pool.connect();

    try {
      const result = await client.query(
        `SELECT 
            r.id AS request_id,
            r.otp_code,
            r.amount,
            r.created_at,
            a.id AS account_id,
            u.email
         FROM otp_requests r
         JOIN accounts a ON r.account_id = a.id
         JOIN users u ON a.user_id = u.id
         WHERE r.is_verified = FALSE
         ORDER BY r.created_at DESC
         LIMIT 1`
      );

      if (result.rows.length === 0) {
        return res.json({
          success: true,
          message: "No pending OTP requests found."
        });
      }

      const row = result.rows[0];

      res.json({
        success: true,
        pending_otp: {
          request_id: row.request_id,
          otp_code: row.otp_code,
          amount: row.amount,
          account_id: row.account_id,
          user_email: row.email,
          created_at: row.created_at,
          message: "Use this request_id + otp_code with /api/transactions/verify-otp"
        }
      });

    } catch (err) {
      console.error("Dashboard Fetch Error:", err);
      res.status(500).json({
        error: "Failed to fetch OTP dashboard data. Possibly incorrect JOIN or column name."
      });
    } finally {
      client.release();
    }
  });

  return router;
};

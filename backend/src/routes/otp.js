const express = require('express');
const router = express.Router();

module.exports = function (pool) {

  // GET /api/otp/dashboard
  router.get('/dashboard', async (req, res) => {
    console.log(" dashboard called");
    const client = await pool.connect();

    try {
      console.log(" OTP dashboard request");

      // always fetch latest VALID otp only
      const result = await client.query(
        `SELECT 
            r.id AS request_id,
            r.otp_code,
            r.amount,
            r.created_at,
            r.expires_at,
            a.id AS account_id,
            u.email
         FROM otp_requests r
         JOIN accounts a ON r.account_id = a.id
         JOIN users u ON a.user_id = u.id
         WHERE r.is_verified = FALSE
           AND r.expires_at > NOW()
         ORDER BY r.created_at DESC
         LIMIT 1`
      );

      if (result.rows.length === 0) {
        return res.status(200).json({
          success: true,
          pending_otp: null,
          message: "No active OTP pending"
        });
      }

      const otp = result.rows[0];

      return res.status(200).json({
        success: true,
        pending_otp: {
          request_id: otp.request_id,
          otp_code: otp.otp_code,
          amount: otp.amount,
          account_id: otp.account_id,
          user_email: otp.email,
          created_at: otp.created_at,
          expires_at: otp.expires_at
        }
      });

    } catch (err) {
      console.error("❌ OTP dashboard error:", err.message);

      return res.status(500).json({
        success: false,
        error: "Dashboard fetch failed"
      });
    } finally {
      client.release();
    }
  });

  return router;
};

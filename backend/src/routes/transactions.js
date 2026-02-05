const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

//
// 🔐 AUTH MIDDLEWARE
//
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token provided" });

  const token = header.split(" ")[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

//
// =====================================================
// 1️⃣ TRANSFER MONEY (SYNC)
// =====================================================
//
router.post("/transfer", auth, async (req, res) => {
  const { from_account, to_account, amount } = req.body;

  if (!from_account || !to_account || !amount)
    return res.status(400).json({ error: "Missing fields" });

  if (Number(amount) <= 0)
    return res.status(400).json({ error: "Amount must be > 0" });

  if (from_account === to_account)
    return res.status(400).json({ error: "Cannot transfer to same account" });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const accounts = await client.query(
      `SELECT * FROM accounts WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`,
      [from_account, to_account]
    );

    if (accounts.rows.length !== 2)
      throw new Error("Account not found");

    const fromAcc = accounts.rows.find(a => a.id === from_account);
    const toAcc = accounts.rows.find(a => a.id === to_account);

    if (fromAcc.user_id !== req.user.id)
      throw new Error("Unauthorized transfer");

    if (Number(fromAcc.balance) < Number(amount))
      throw new Error("Insufficient funds");

    const newFrom = Number(fromAcc.balance) - Number(amount);
    const newTo = Number(toAcc.balance) + Number(amount);

    await client.query("UPDATE accounts SET balance=$1 WHERE id=$2", [newFrom, from_account]);
    await client.query("UPDATE accounts SET balance=$1 WHERE id=$2", [newTo, to_account]);

    await client.query(
      `INSERT INTO transactions (account_id, type, amount, counterparty)
       VALUES ($1,'transfer-out',$2,$3)`,
      [from_account, amount, to_account]
    );

    await client.query(
      `INSERT INTO transactions (account_id, type, amount, counterparty)
       VALUES ($1,'transfer-in',$2,$3)`,
      [to_account, amount, from_account]
    );

    await client.query(
      `INSERT INTO transaction_events (account_id, amount, type)
       VALUES ($1,$2,'transfer')`,
      [from_account, amount]
    );

    await client.query("COMMIT");
    res.json({ success: true, from_balance: newFrom, to_balance: newTo });

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

//
// =====================================================
// 2️⃣ VERIFY OTP
// =====================================================
//
router.post("/verify-otp", auth, async (req, res) => {
  const { request_id, otp } = req.body;

  if (!request_id || !otp)
    return res.status(400).json({ error: "Missing request_id or otp" });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const q = await client.query(
      `SELECT * FROM otp_requests WHERE id=$1 AND is_verified=FALSE`,
      [request_id]
    );

    if (q.rows.length === 0)
      throw new Error("OTP request not found or already verified");

    const entry = q.rows[0];

    if (new Date(entry.expires_at) < new Date())
      throw new Error("OTP expired");

    if (entry.otp_code !== otp)
      throw new Error("Incorrect OTP");

    await client.query(
      `UPDATE otp_requests SET is_verified=TRUE, verified_at=NOW() WHERE id=$1`,
      [request_id]
    );

    await client.query(
      `UPDATE transaction_events SET is_otp_verified=TRUE WHERE id=$1`,
      [entry.event_id]
    );

    await client.query("COMMIT");
    res.json({ success: true, message: "OTP verified. Withdrawal processing." });

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

//
// =====================================================
// 3️⃣ DEPOSIT / WITHDRAW
// =====================================================
//
router.post("/:accountId", auth, async (req, res) => {
  const { accountId } = req.params;
  const { type, amount } = req.body;
  const numericalAmount = Number(amount);

  if (!["deposit", "withdraw"].includes(type))
    return res.status(400).json({ error: "Invalid type" });

  if (numericalAmount <= 0)
    return res.status(400).json({ error: "Amount must be > 0" });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const acc = await client.query(
      "SELECT * FROM accounts WHERE id=$1 FOR UPDATE",
      [accountId]
    );

    if (acc.rows.length === 0)
      throw new Error("Account not found");

    const account = acc.rows[0];

    if (account.user_id !== req.user.id)
      throw new Error("Unauthorized");

    // ---------- DEPOSIT ----------
    if (type === "deposit") {
      const newBal = Number(account.balance) + numericalAmount;

      await client.query("UPDATE accounts SET balance=$1 WHERE id=$2", [newBal, accountId]);
      await client.query(
        `INSERT INTO transactions (account_id,type,amount)
         VALUES ($1,$2,$3)`,
        [accountId, type, numericalAmount]
      );
      await client.query(
        `INSERT INTO transaction_events (account_id,amount,type)
         VALUES ($1,$2,$3)`,
        [accountId, numericalAmount, type]
      );

      await client.query("COMMIT");
      return res.json({ success: true, balance: newBal });
    }

    // ---------- WITHDRAW <= 10000 ----------
    if (numericalAmount <= 10000) {
      if (Number(account.balance) < numericalAmount)
        throw new Error("Insufficient balance");

      const newBal = Number(account.balance) - numericalAmount;

      await client.query("UPDATE accounts SET balance=$1 WHERE id=$2", [newBal, accountId]);
      await client.query(
        `INSERT INTO transactions (account_id,type,amount)
         VALUES ($1,$2,$3)`,
        [accountId, type, numericalAmount]
      );
      await client.query(
        `INSERT INTO transaction_events (account_id,amount,type)
         VALUES ($1,$2,$3)`,
        [accountId, numericalAmount, type]
      );

      await client.query("COMMIT");
      return res.json({ success: true, balance: newBal });
    }

    // ---------- WITHDRAW > 10000 (OTP REQUIRED) ----------

    const eventRes = await client.query(
      `INSERT INTO transaction_events (account_id,amount,type,initial_balance)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [accountId, numericalAmount, type, account.balance]
    );

    const eventId = eventRes.rows[0].id;

    await client.query(
  `
  INSERT INTO fraud_alerts (
    event_id,
    account_id,
    reason,
    severity
  )
  VALUES ($1, $2, $3, $4)
  `,
  [
    eventId,
    accountId,
    "High-value withdrawal pending OTP verification",
    "critical"
  ]
);


    const existingOtp = await client.query(
      `
      SELECT id, expires_at
      FROM otp_requests
      WHERE account_id=$1
        AND event_id=$2
        AND is_verified=FALSE
        AND expires_at > NOW()
      LIMIT 1
      `,
      [accountId, eventId]
    );

    if (existingOtp.rows.length > 0) {
      await client.query("COMMIT");
      return res.status(429).json({
        error: "OTP already sent",
        request_id: existingOtp.rows[0].id,
        expires_at: existingOtp.rows[0].expires_at
      });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const otpRes = await client.query(
      `
      INSERT INTO otp_requests (event_id,account_id,amount,otp_code,expires_at)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id, expires_at
      `,
      [eventId, accountId, numericalAmount, otpCode, expiresAt]
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "OTP required for withdrawal",
      request_id: otpRes.rows[0].id,
      expires_at: otpRes.rows[0].expires_at
    });

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;

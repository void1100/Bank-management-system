require("dotenv").config();
const { Pool } = require("pg");
const axios = require("axios");

console.log("🤖 ML Worker started — Hybrid Fraud Detection Active...");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ------------------------------------------------------
// ML CALL
// ------------------------------------------------------
async function getMLScore(event) {
  try {
    const mlRes = await axios.post(
      `${process.env.ML_SERVICE_URL}/score`,
      {
        amount: Number(event.amount),
        type: event.type,
        account_id: event.account_id,
        timestamp: event.created_at,
      },
      { timeout: 1500 }
    );

    return mlRes.data.score;
  } catch {
    console.log("⚠ ML unavailable — fallback rules only.");
    return null;
  }
}

// ------------------------------------------------------
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ------------------------------------------------------
// RULE ENGINE
// ------------------------------------------------------
async function ruleBasedFraud(client, event) {
  const amount = Number(event.amount);

  // 🔴 HIGH VALUE WITHDRAW
  if (event.type === "withdraw" && amount > 10000) {

    // check existing valid OTP
    const existingOtp = await client.query(
      `SELECT id FROM otp_requests
       WHERE event_id=$1
       AND is_verified=false
       AND expires_at > NOW()
       LIMIT 1`,
      [event.id]
    );

    if (existingOtp.rows.length > 0) {
      console.log("⏸ Existing OTP still active. Waiting verification.");
      return "OTP_PENDING";
    }

    // generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await client.query(
      `INSERT INTO otp_requests
       (event_id, account_id, amount, otp_code, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [event.id, event.account_id, amount, otp, expiresAt]
    );

    console.log(`🔐 OTP generated for event ${event.id}:`, otp);

    await client.query(
      `INSERT INTO fraud_alerts (event_id, account_id, reason, severity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.account_id, "High-value withdrawal OTP required", "critical"]
    );

    return "OTP_PENDING";
  }

  // 🔵 Large deposit alert
  if (event.type === "deposit" && amount > 5000) {
    await client.query(
      `INSERT INTO fraud_alerts (event_id, account_id, reason, severity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.account_id, "Large deposit flagged", "high"]
    );
  }

  // 🟡 Burst activity
  const rapid = await client.query(
    `SELECT COUNT(*) FROM transactions
     WHERE account_id=$1 AND created_at > NOW() - INTERVAL '10 seconds'`,
    [event.account_id]
  );

  if (Number(rapid.rows[0].count) >= 5) {
    await client.query(
      `INSERT INTO fraud_alerts (event_id, account_id, reason, severity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.account_id, "Burst activity detected", "medium"]
    );
  }

  return "OK";
}

// ------------------------------------------------------
// FINAL WITHDRAW AFTER OTP VERIFIED
// ------------------------------------------------------
async function executeVerifiedWithdrawal(client, event) {
  console.log(`💡 OTP VERIFIED → executing withdrawal ${event.id}`);

  const amount = Number(event.amount);

  const acc = await client.query(
    "SELECT balance FROM accounts WHERE id=$1 FOR UPDATE",
    [event.account_id]
  );

  const balance = Number(acc.rows[0].balance);
  if (balance < amount) throw new Error("Insufficient balance.");

  const newBalance = balance - amount;

  await client.query(
    "UPDATE accounts SET balance=$1 WHERE id=$2",
    [newBalance, event.account_id]
  );

  await client.query(
    `INSERT INTO transactions (account_id,type,amount)
     VALUES ($1,'withdraw',$2)`,
    [event.account_id, amount]
  );
}

// ------------------------------------------------------
// MAIN PROCESSOR
// ------------------------------------------------------
async function processNextEvent() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT * FROM transaction_events
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    const event = result.rows[0];
    console.log("⚡ Processing:", event.id, event.type, event.amount);

    // --------------------------------------------------
    // OTP VERIFIED → EXECUTE
    // --------------------------------------------------
    if (event.is_otp_verified === true && event.type === "withdraw") {
      await executeVerifiedWithdrawal(client, event);

      await client.query(`DELETE FROM transaction_events WHERE id=$1`, [event.id]);
      await client.query("COMMIT");

      console.log(`✔ Withdrawal completed ${event.id}`);
      return true;
    }

    // --------------------------------------------------
    // ML SCORE
    // --------------------------------------------------
    const mlScore = await getMLScore(event);

    if (mlScore !== null) {
      await client.query(
        `INSERT INTO fraud_scores (event_id,account_id,score)
         VALUES ($1,$2,$3)
         ON CONFLICT (event_id)
         DO UPDATE SET score=EXCLUDED.score`,
        [event.id, event.account_id, mlScore]
      );

      if (mlScore > 0.75) {
        await client.query(
          `INSERT INTO fraud_alerts (event_id,account_id,reason,severity)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (event_id) DO NOTHING`,
          [event.id, event.account_id, "ML anomaly detected", "critical"]
        );
      }
    }

    // --------------------------------------------------
    // RULE ENGINE
    // --------------------------------------------------
    const ruleStatus = await ruleBasedFraud(client, event);

    if (ruleStatus === "OTP_PENDING") {
      await client.query("COMMIT");
      console.log(`⏸ Waiting OTP verification for ${event.id}`);
      return false; // stop loop processing same event repeatedly
    }

    // --------------------------------------------------
    // NORMAL COMPLETE
    // --------------------------------------------------
    await client.query(
      `INSERT INTO audit_logs (event_id, info)
       VALUES ($1,$2)`,
      [event.id, `Completed ${event.type} ₹${event.amount}`]
    );

    await client.query(`DELETE FROM transaction_events WHERE id=$1`, [event.id]);
    await client.query("COMMIT");

    console.log(`✔ Event processed ${event.id}`);
    return true;

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Worker error:", err.message);
    return false;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------
// LOOP
// ------------------------------------------------------
async function loop() {
  while (true) {
    const ok = await processNextEvent();
    if (!ok) await new Promise(r => setTimeout(r, 2000));
  }
}

loop();


//docker exec -it banking-postgres psql -U postgres -d bank
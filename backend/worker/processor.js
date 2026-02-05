require("dotenv").config();
const { Pool } = require("pg");
const axios = require("axios");

console.log("🤖 ML Worker started — Hybrid Fraud Detection Active...");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ------------------------------------------------------
// ML Microservice Call
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
  } catch (err) {
    console.log("⚠ ML service unavailable — using fallback rules.");
    return null;
  }
}

// ------------------------------------------------------
// OTP GENERATOR
// ------------------------------------------------------
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ------------------------------------------------------
// RULE-BASED FRAUD (FIRST PASS)
// ------------------------------------------------------
async function ruleBasedFraud(client, event) {
  const amount = Number(event.amount);

  // RULE — High-value withdrawal needs OTP
  if (event.type === "withdraw" && amount > 10000) {
    const otp = generateOTP();

    await client.query(
      `INSERT INTO otp_requests (event_id, account_id, amount, otp_code)
       VALUES ($1, $2, $3, $4)`,
      [event.id, event.account_id, amount, otp]
    );

    console.log(`🔐 OTP generated for event ${event.id}:`, otp);

    await client.query(
      `INSERT INTO fraud_alerts (event_id, account_id, reason, severity)
       VALUES ($1, $2, $3, $4)`,
      [event.id, event.account_id, "Large withdrawal needs OTP", "critical"]
    );

    // Event stays in queue → but paused until OTP is verified
    return "OTP_PENDING";
  }

  // RULE — Large deposit
  if (event.type == "deposit" && amount > 5000) {
    await client.query(
      `INSERT INTO fraud_alerts (event_id, account_id, reason, severity)
       VALUES ($1, $2, $3, $4)`,
      [event.id, event.account_id, "Large deposit flagged", "high"]
    );
  }

  // RULE — Burst activity
  const rapid = await client.query(
    `SELECT COUNT(*) FROM transactions
     WHERE account_id=$1 AND created_at > NOW() - INTERVAL '10 seconds'`,
    [event.account_id]
  );

  if (Number(rapid.rows[0].count) >= 5) {
    await client.query(
      `INSERT INTO fraud_alerts (event_id, account_id, reason, severity)
       VALUES ($1, $2, $3, $4)`,
      [event.id, event.account_id,"Burst activity detected", 'medium']
    );
  }

  return "OK";
}

// ------------------------------------------------------
// EXECUTE FINAL WITHDRAWAL
// ------------------------------------------------------
async function executeVerifiedWithdrawal(client, event) {
  console.log(`💡 OTP VERIFIED → executing withdrawal for event ${event.id}`);

  const amount = Number(event.amount);

  const acc = await client.query(
    "SELECT balance FROM accounts WHERE id=$1 FOR UPDATE",
    [event.account_id]
  );

  const balance = Number(acc.rows[0].balance);
  if (balance < amount) {
    throw new Error("Insufficient balance during final execution.");
  }

  const newBalance = balance - amount;

  await client.query(
    "UPDATE accounts SET balance=$1 WHERE id=$2",
    [newBalance, event.account_id]
  );

  await client.query(
    `INSERT INTO transactions (account_id, type, amount)
     VALUES ($1, 'withdraw', $2)`,
    [event.account_id, amount]
  );
}

// ------------------------------------------------------
// MAIN PROCESSOR LOOP
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
    console.log("⚡ Processing event:", event);

    // --------------------------------------------------
    // SECOND PASS — OTP VERIFIED
    // --------------------------------------------------
    if (event.is_otp_verified === true && event.type === "withdraw") {
      await executeVerifiedWithdrawal(client, event);

      // remove event now
      await client.query(`DELETE FROM transaction_events WHERE id=$1`, [
        event.id,
      ]);

      await client.query("COMMIT");
      console.log(`✔ Withdrawal completed for event ${event.id}`);
      return true;
    }

    

    // --------------------------------------------------
    // FIRST PASS — ML SCORE
    // --------------------------------------------------
    const mlScore = await getMLScore(event);

   if (mlScore !== null) {
  // Upsert fraud score – never blow up on duplicate event_id
  await client.query(
    `INSERT INTO fraud_scores (event_id, account_id, score)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id)
     DO UPDATE SET score = EXCLUDED.score`,
    [event.id, event.account_id, mlScore]
  );

  if (mlScore > 0.75) {
    await client.query(
      `INSERT INTO fraud_alerts (event_id, account_id, reason, severity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.account_id, 'ML anomaly score high', 'critical']
    );
  }
}


    // --------------------------------------------------
    // RULE ENGINE
    // --------------------------------------------------
    const ruleStatus = await ruleBasedFraud(client, event);

    if (ruleStatus === "OTP_PENDING") {
      await client.query("COMMIT");
      console.log(`⏸ Event ${event.id} paused (waiting for OTP verification).`);
      return true;
    }

    // Normal event completion
    await client.query(
      `INSERT INTO audit_logs (event_id, info)
       VALUES ($1, $2)`,
      [event.id, `Completed ${event.type} ₹${event.amount}`]
    );

    await client.query(`DELETE FROM transaction_events WHERE id=$1`, [
      event.id,
    ]);

    await client.query("COMMIT");
    console.log(`✔ Event ${event.id} fully processed.`);
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Worker error:", err);
    return false;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------
// CONTINUOUS LOOP
// ------------------------------------------------------
async function loop() {
  while (true) {
    const ok = await processNextEvent();
    if (!ok) await new Promise((r) => setTimeout(r, 1500));
  }
}

loop();

//docker exec -it banking-postgres psql -U postgres -d bank
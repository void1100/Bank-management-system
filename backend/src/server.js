require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();   // ✅ CREATE APP FIRST
app.use(cors());
app.use(express.json());

// create DB pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// import routes
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions.js');
const otpRoutes = require("./routes/otp");
const historyRoutes = require("./routes/history");
const graphRoutes = require("./routes/graph");
const fraudRoutes = require("./routes/fraud");
const accountRoutes = require('./routes/accounts');

// health check
app.get('/health', (req, res) => res.json({ ok: true }));

// mount routes
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/accounts', accountRoutes);
app.use("/api/otp", otpRoutes(pool));   // ✅ PASS POOL HERE
app.use("/api/history", historyRoutes);
app.use("/api/graph", graphRoutes);
app.use("/api/fraud-alerts", fraudRoutes);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend running on port ${port}`));

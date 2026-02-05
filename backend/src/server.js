require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions.js');
const otpRoutes = require("./routes/otp");
const historyRoutes = require("./routes/history");
const graphRoutes = require("./routes/graph");
const fraudRoutes = require("./routes/fraud");

// accounts router
const accountRoutes = require('./routes/accounts'); 

const app = express();
app.use(cors());
app.use(express.json()); 

// health check
app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);

// accounts API
app.use('/api/accounts', accountRoutes);
app.use("/api/otp", otpRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/graph", graphRoutes);
app.use("/api/fraud-alerts", fraudRoutes);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend running on port ${port}`));

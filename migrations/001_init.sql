-- -----------------------------------------------------
-- Set up UUID generation
-- -----------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------
-- Core Tables (Parent Tables)
-- -----------------------------------------------------

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    kyc_status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE accounts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    account_number TEXT UNIQUE, -- Should be unique, but allowing NULL if account creation logic changes
    account_type TEXT NOT NULL,
    currency TEXT DEFAULT 'INR',
    balance NUMERIC(18,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------
-- Event Queue (Parent for all Worker Logs)
-- -----------------------------------------------------

-- This is the event queue the worker reads from. 
CREATE TABLE transaction_events (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    amount NUMERIC(18,2) NOT NULL,
    type TEXT NOT NULL,
    -- CRITICAL FOR WITHDRAWAL LOGIC: Used to safely execute delayed deductions
    initial_balance NUMERIC(18,2), 
    is_otp_verified BOOLEAN DEFAULT FALSE, 
    created_at TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------
-- Transaction History & Worker Logs (Dependent Tables)
-- -----------------------------------------------------

-- Standard Transaction History Log
CREATE TABLE transactions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
    counterparty TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- OTP Requests Table
CREATE TABLE otp_requests (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Links to transaction_events; CASCADE ensures cleanup on event deletion
    event_id uuid UNIQUE REFERENCES transaction_events(id) ON DELETE CASCADE, 
    account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
    amount NUMERIC(18,2) NOT NULL,
    otp_code TEXT NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Fraud Scores Table
CREATE TABLE fraud_scores (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Links to transaction_events; CASCADE ensures cleanup on event deletion
    event_id uuid UNIQUE REFERENCES transaction_events(id) ON DELETE CASCADE, 
    account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
    score NUMERIC(5,4) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Fraud Alerts Table
CREATE TABLE fraud_alerts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Links to transaction_events; CASCADE ensures cleanup on event deletion
    event_id uuid UNIQUE REFERENCES transaction_events(id) ON DELETE CASCADE, 
    account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
    -- CRITICAL: Links to users (via getUserIdFromAccount helper)
    user_id uuid REFERENCES users(id) ON DELETE CASCADE, 
    reason TEXT NOT NULL,
    severity TEXT NOT NULL,
    is_resolved BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Audit Logs Table
CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Links to transaction_events; CASCADE ensures cleanup on event deletion
    event_id uuid UNIQUE REFERENCES transaction_events(id) ON DELETE CASCADE, 
    info TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------
-- General Alert Table (for UI display)
-- -----------------------------------------------------

CREATE TABLE alerts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
    alert_type TEXT,
    data JSONB,
    resolved BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);
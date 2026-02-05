CREATE TABLE IF NOT EXISTS otp_requestss (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    event_id UUID NOT NULL,
    account_id UUID NOT NULL,

    otp_code VARCHAR(6) NOT NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '5 minutes',

    FOREIGN KEY (event_id) REFERENCES transaction_events(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS otp_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),


    event_id UUID,                         

  
    account_id UUID NOT NULL,

   
    amount NUMERIC(18,2) NOT NULL,

    type TEXT NOT NULL DEFAULT 'withdraw',
    otp_code TEXT NOT NULL,
    verified BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

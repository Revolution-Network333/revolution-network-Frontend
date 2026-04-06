-- Révolution Network - Database Schema
-- PostgreSQL Database

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    wallet_address VARCHAR(255),
    solana_address VARCHAR(255),
    profile_picture_url VARCHAR(255),
    total_points INTEGER DEFAULT 0,
    trust_score INTEGER DEFAULT 100,
    is_active BOOLEAN DEFAULT true,
    is_banned BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    airdrop_score INTEGER DEFAULT 0,
    airdrop_allocation DECIMAL(20, 8) DEFAULT 0,
    last_airdrop_calculation TIMESTAMP
);

-- Sessions table (tracking active P2P sessions)
CREATE TABLE sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    peers_connected INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active'
);

-- Bandwidth logs (tracking upload/download)
CREATE TABLE bandwidth_logs (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    verified BOOLEAN DEFAULT false
);

-- Rewards ledger (immutable transaction log)
CREATE TABLE rewards_ledger (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL,
    reason VARCHAR(100) NOT NULL,
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Daily stats (aggregated per user per day)
CREATE TABLE daily_stats (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_time_seconds INTEGER DEFAULT 0,
    total_bytes_sent BIGINT DEFAULT 0,
    total_bytes_received BIGINT DEFAULT 0,
    total_points_earned INTEGER DEFAULT 0,
    sessions_count INTEGER DEFAULT 0,
    UNIQUE(user_id, date)
);

-- Fraud detection logs
CREATE TABLE fraud_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    fraud_type VARCHAR(100) NOT NULL,
    description TEXT,
    severity VARCHAR(20) DEFAULT 'low',
    ip_address VARCHAR(45),
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS banned_ips (
    id SERIAL PRIMARY KEY,
    ip_address VARCHAR(45) UNIQUE NOT NULL,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Peer connections (for tracking who connects to whom)
CREATE TABLE peer_connections (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    peer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    peer_session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    disconnected_at TIMESTAMP,
    bytes_exchanged BIGINT DEFAULT 0
);

-- Indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_active ON sessions(is_active);
CREATE INDEX idx_bandwidth_logs_session ON bandwidth_logs(session_id);
CREATE INDEX idx_bandwidth_logs_timestamp ON bandwidth_logs(timestamp);
CREATE INDEX idx_rewards_ledger_user ON rewards_ledger(user_id);
CREATE INDEX idx_rewards_ledger_created ON rewards_ledger(created_at);
CREATE INDEX idx_daily_stats_user_date ON daily_stats(user_id, date);
CREATE INDEX idx_fraud_logs_user ON fraud_logs(user_id);
CREATE INDEX idx_fraud_logs_detected ON fraud_logs(detected_at);

-- Trigger to update user's total points
CREATE OR REPLACE FUNCTION update_user_points()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE users 
        SET total_points = total_points + NEW.amount,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_points
AFTER INSERT ON rewards_ledger
FOR EACH ROW
EXECUTE FUNCTION update_user_points();

-- Function to calculate daily stats
CREATE OR REPLACE FUNCTION calculate_daily_stats(p_user_id INTEGER, p_date DATE)
RETURNS void AS $$
BEGIN
    INSERT INTO daily_stats (user_id, date, total_time_seconds, total_bytes_sent, total_bytes_received, total_points_earned, sessions_count)
    SELECT 
        s.user_id,
        p_date,
        COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(s.end_time, CURRENT_TIMESTAMP) - s.start_time))), 0)::INTEGER,
        COALESCE(SUM(bl.bytes_sent), 0),
        COALESCE(SUM(bl.bytes_received), 0),
        COALESCE(SUM(rl.amount), 0),
        COUNT(DISTINCT s.id)
    FROM sessions s
    LEFT JOIN bandwidth_logs bl ON s.id = bl.session_id
    LEFT JOIN rewards_ledger rl ON s.id = rl.session_id
    WHERE s.user_id = p_user_id
    AND DATE(s.start_time) = p_date
    GROUP BY s.user_id
    ON CONFLICT (user_id, date) 
    DO UPDATE SET
        total_time_seconds = EXCLUDED.total_time_seconds,
        total_bytes_sent = EXCLUDED.total_bytes_sent,
        total_bytes_received = EXCLUDED.total_bytes_received,
        total_points_earned = EXCLUDED.total_points_earned,
        sessions_count = EXCLUDED.sessions_count;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);

CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_subscription_id VARCHAR(255) NOT NULL,
    plan_name VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_hash VARCHAR(255) NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);

CREATE TABLE IF NOT EXISTS enterprise_credits (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credits_balance BIGINT DEFAULT 0, -- Total GB remaining (in MB or actual GB, let's use MB for precision)
    credits_used_month BIGINT DEFAULT 0, -- Total MB used this month
    bandwidth_limit_gb INTEGER DEFAULT 0, -- Monthly quota in GB
    priority_level INTEGER DEFAULT 1, -- 1: Normal, 2: High, 3: Ultra
    reset_date TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enterprise_credits_user ON enterprise_credits(user_id);

CREATE TABLE IF NOT EXISTS credit_ledger (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL,
    reason VARCHAR(100),
    job_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_created ON credit_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_job ON credit_ledger(job_id);

CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    payload JSONB,
    result JSONB,
    credits_cost BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    link_url VARCHAR(500),
    reward_points INTEGER DEFAULT 0,
    reward_airdrop_bonus_percent INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(active);

CREATE TABLE IF NOT EXISTS user_tasks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'not_started',
    timestamp_click TIMESTAMP,
    timestamp_approved TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_tasks_user ON user_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tasks_task ON user_tasks(task_id);

CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id);

CREATE TABLE IF NOT EXISTS user_airdrop_stats (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    base_points INTEGER DEFAULT 0,
    grade VARCHAR(50),
    grade_multiplier NUMERIC(5,2) DEFAULT 1.00,
    referral_count INTEGER DEFAULT 0,
    referral_bonus_points INTEGER DEFAULT 0,
    task_bonus_points INTEGER DEFAULT 0,
    final_airdrop_score NUMERIC(20,4) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_activity (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_start TIMESTAMP,
    session_end TIMESTAMP,
    duration_minutes INTEGER DEFAULT 0,
    p2p_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity(user_id);

CREATE TABLE IF NOT EXISTS early_adopters (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_gold BOOLEAN DEFAULT false,
    aether_awarded INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS shop_items (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    price NUMERIC(18,6) NOT NULL,
    currency VARCHAR(10) DEFAULT 'EUR',
    active BOOLEAN DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shop_items_type ON shop_items(type);
CREATE INDEX IF NOT EXISTS idx_shop_items_active ON shop_items(active);

INSERT INTO users (email, password_hash, username, role, is_active, created_at)
SELECT 'korn666', '741852963', 'korn666', 'admin', true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'korn666')
ON CONFLICT (username) DO NOTHING;

import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
-- ============================================================ 
-- CONFIGURATION SYSTÈME 
-- Toutes les valeurs métier viennent d'ici — jamais du code 
-- ============================================================ 
CREATE TABLE system_config ( 
  \`key\`       VARCHAR(100)  PRIMARY KEY, 
  \`value\`     TEXT          NOT NULL, 
  description TEXT, 
  updated_at  DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) 
               ON UPDATE CURRENT_TIMESTAMP(6) 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; 

INSERT INTO system_config VALUES 
  ('node_min_reputation',      '30',   'Score minimum pour recevoir des jobs',              NOW(6)), 
  ('node_heartbeat_timeout_s', '30',   'Secondes avant qu''un node soit offline',           NOW(6)), 
  ('settlement_node_share',    '0.75', 'Part du revenu reversée au node operator',          NOW(6)), 
  ('platform_share',           '0.25', 'Part conservée par la plateforme',                  NOW(6)), 
  ('node_reputation_gain',     '2',    'Points gagnés par job réussi',                      NOW(6)), 
  ('node_reputation_penalty',  '10',   'Points perdus par job échoué',                      NOW(6)), 
  ('node_reputation_max',      '100',  'Score maximum de réputation',                       NOW(6)), 
  ('max_retry_attempts',       '3',    'Tentatives max avant failed',                       NOW(6)), 
  ('credit_topup_min_eur',     '5',    'Recharge minimale en euros',                        NOW(6)); 

-- ============================================================ 
-- UTILISATEURS / CLIENTS API 
-- ============================================================ 
CREATE TABLE users ( 
  id               CHAR(36)      PRIMARY KEY, 
  email            VARCHAR(255)  UNIQUE NOT NULL, 
  api_key_hash     VARCHAR(255)  UNIQUE NOT NULL,   -- argon2id hash 
  api_key_prefix   VARCHAR(12)   NOT NULL,           -- 12 premiers chars pour lookup rapide 
  credits_balance  DECIMAL(14,8) NOT NULL DEFAULT 0, 
  is_active        TINYINT(1)    NOT NULL DEFAULT 1, 
  created_at       DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6), 
  updated_at       DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) 
                   ON UPDATE CURRENT_TIMESTAMP(6), 
 
  CONSTRAINT chk_credits_positive CHECK (credits_balance >= 0), 
  INDEX idx_api_key_prefix (api_key_prefix), 
  INDEX idx_users_email    (email) 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; 

-- ============================================================ 
-- TYPES DE JOBS ET CONFIGURATION DE COÛT 
-- Les prix viennent d'ici, jamais du code 
-- ============================================================ 
CREATE TABLE job_types ( 
  type               VARCHAR(50)   PRIMARY KEY, 
  node_type          VARCHAR(50)   NOT NULL, 
  credits_cost       DECIMAL(10,8) NOT NULL, 
  gb_cost_internal   DECIMAL(8,4)  NOT NULL,   -- interne, jamais exposé en API 
  cpu_cost_internal  DECIMAL(8,4)  NOT NULL,   -- interne, jamais exposé en API 
  timeout_seconds    INT           NOT NULL DEFAULT 300, 
  max_input_size_mb  INT           NOT NULL DEFAULT 500, 
  is_active          TINYINT(1)    NOT NULL DEFAULT 1, 
  description        TEXT, 
  updated_at         DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) 
                     ON UPDATE CURRENT_TIMESTAMP(6), 
 
  CONSTRAINT chk_credits_cost_pos CHECK (credits_cost > 0) 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; 

INSERT INTO job_types VALUES 
  ('video_transcode', 'ffmpeg',  0.05000000, 0.8,  12.0, 600, 2000, 1, 'Transcodage vidéo MP4/WebM',  NOW(6)), 
  ('audio_convert',   'ffmpeg',  0.01500000, 0.2,  3.0,  120, 500,  1, 'Conversion audio MP3/AAC/WAV',NOW(6)), 
  ('code_run_js',     'sandbox', 0.00800000, 0.05, 1.0,  30,  5,    1, 'Exécution JavaScript isolé',  NOW(6)), 
  ('svg_generate',    'image',   0.00200000, 0.1,  2.0,  60,  50,   1, 'Génération SVG',              NOW(6)), 
  ('text_generate',   'text',    0.00300000, 0.02, 0.5,  30,  10,   1, 'Génération de texte',         NOW(6)); 

-- ============================================================ 
-- NODES D'EXÉCUTION (operators DePIN) 
-- ============================================================ 
CREATE TABLE nodes ( 
  id                   CHAR(36)      PRIMARY KEY, 
  operator_email       VARCHAR(255)  NOT NULL, 
  node_type            VARCHAR(50)   NOT NULL, 
  wallet_balance       DECIMAL(14,8) NOT NULL DEFAULT 0, 
  reputation_score     INT           NOT NULL DEFAULT 100, 
  is_active            TINYINT(1)    NOT NULL DEFAULT 1, 
  last_heartbeat       DATETIME(6), 
  total_jobs_completed INT           NOT NULL DEFAULT 0, 
  total_jobs_failed    INT           NOT NULL DEFAULT 0, 
  endpoint_url         VARCHAR(500)  NOT NULL, 
  created_at           DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6), 
  updated_at           DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) 
                        ON UPDATE CURRENT_TIMESTAMP(6), 
 
  CONSTRAINT chk_wallet_positive CHECK (wallet_balance >= 0), 
  CONSTRAINT chk_rep_range       CHECK (reputation_score BETWEEN 0 AND 100), 
  INDEX idx_nodes_routing (node_type, is_active, reputation_score) 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; 

-- ============================================================ 
-- JOBS SOUMIS PAR LES CLIENTS 
-- ============================================================ 
CREATE TABLE jobs ( 
  id              CHAR(36)      PRIMARY KEY, 
  user_id         CHAR(36)      NOT NULL, 
  type            VARCHAR(50)   NOT NULL, 
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending', 
  credits_charged DECIMAL(10,8) NOT NULL, 
  input_payload   JSON          NOT NULL, 
  output_payload  JSON, 
  error_message   TEXT, 
  node_id         CHAR(36), 
  retry_count     INT           NOT NULL DEFAULT 0, 
  created_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6), 
  started_at      DATETIME(6), 
  completed_at    DATETIME(6), 
  updated_at      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) 
                   ON UPDATE CURRENT_TIMESTAMP(6), 
 
  CONSTRAINT chk_status        CHECK (status IN ('pending','processing','completed','failed')), 
  CONSTRAINT chk_credits_pos   CHECK (credits_charged > 0), 
  CONSTRAINT chk_completed_out CHECK (status != 'completed' OR output_payload IS NOT NULL), 
  CONSTRAINT chk_failed_err    CHECK (status != 'failed'    OR error_message  IS NOT NULL), 
 
  FOREIGN KEY (user_id) REFERENCES users(id), 
  FOREIGN KEY (type)    REFERENCES job_types(type), 
  FOREIGN KEY (node_id) REFERENCES nodes(id), 
 
  INDEX idx_jobs_user_id    (user_id), 
  INDEX idx_jobs_status     (status), 
  INDEX idx_jobs_node_id    (node_id), 
  INDEX idx_jobs_created_at (created_at DESC) 
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; 

-- ============================================================ 
-- PREUVES D'EXÉCUTION (settlement layer DePIN) 
-- UNIQUE sur job_id = un seul settlement possible par job 
-- ============================================================ 
CREATE TABLE executions ( 
  id           CHAR(36)      PRIMARY KEY, 
  job_id       CHAR(36)      UNIQUE NOT NULL, 
  node_id      CHAR(36)      NOT NULL, 
  proof_hash   VARCHAR(64)   UNIQUE NOT NULL, 
  gb_used      DECIMAL(8,4)  NOT NULL,    -- interne, jamais exposé en API 
  cpu_seconds  DECIMAL(8,4)  NOT NULL,    -- interne, jamais exposé en API 
  exec_time_ms INT           NOT NULL, 
  node_payout  DECIMAL(10,8) NOT NULL, 
  platform_cut DECIMAL(10,8) NOT NULL, 
  settled_at   DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6), 
 
  FOREIGN KEY (job_id)  REFERENCES jobs(id), 
  FOREIGN KEY (node_id) REFERENCES nodes(id) 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; 

-- ============================================================ 
-- LEDGER DE CRÉDITS (audit trail immuable) 
-- ============================================================ 
CREATE TABLE credit_events ( 
  id                CHAR(36)      PRIMARY KEY, 
  user_id           CHAR(36)      NOT NULL, 
  event_type        VARCHAR(20)   NOT NULL, 
  amount            DECIMAL(10,8) NOT NULL, 
  balance_after     DECIMAL(14,8) NOT NULL, 
  job_id            CHAR(36), 
  stripe_payment_id VARCHAR(255), 
  description       TEXT          NOT NULL, 
  created_at        DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6), 
 
  CONSTRAINT chk_event_type CHECK (event_type IN ('topup','deduction','refund','adjustment')), 
 
  FOREIGN KEY (user_id) REFERENCES users(id), 
  FOREIGN KEY (job_id)  REFERENCES jobs(id), 
 
  INDEX idx_credit_events_user (user_id), 
  INDEX idx_credit_events_job  (job_id) 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; 

-- Triggers pour rendre le ledger immuable 
CREATE TRIGGER prevent_credit_events_update 
  BEFORE UPDATE ON credit_events 
  FOR EACH ROW 
BEGIN 
  SIGNAL SQLSTATE '45000' 
    SET MESSAGE_TEXT = 'credit_events est immuable — UPDATE interdit'; 
END;

CREATE TRIGGER prevent_credit_events_delete 
  BEFORE DELETE ON credit_events 
  FOR EACH ROW 
BEGIN 
  SIGNAL SQLSTATE '45000' 
    SET MESSAGE_TEXT = 'credit_events est immuable — DELETE interdit'; 
END;

-- ============================================================ 
-- BUS D'ÉVÉNEMENTS (outbox pattern) 
-- ============================================================ 
CREATE TABLE domain_events ( 
  id           CHAR(36)     PRIMARY KEY, 
  event_type   VARCHAR(100) NOT NULL, 
  aggregate_id CHAR(36)     NOT NULL, 
  payload      JSON         NOT NULL, 
  published    TINYINT(1)   NOT NULL DEFAULT 0, 
  created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6), 
 
  INDEX idx_domain_events_unpublished (published, created_at) 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4; 
    `);
}


export async function down(knex: Knex): Promise<void> {
    await knex.raw(\`
        DROP TABLE IF EXISTS domain_events;
        DROP TABLE IF EXISTS credit_events;
        DROP TABLE IF EXISTS executions;
        DROP TABLE IF EXISTS jobs;
        DROP TABLE IF EXISTS nodes;
        DROP TABLE IF EXISTS job_types;
        DROP TABLE IF EXISTS users;
        DROP TABLE IF EXISTS system_config;
    \`);
}

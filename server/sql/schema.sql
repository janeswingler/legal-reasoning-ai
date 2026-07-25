-- Legal Reasoning AI — MariaDB / MySQL schema
-- Run once: npm run db:init

CREATE TABLE IF NOT EXISTS assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  participant_id VARCHAR(255) NULL,
  session_id VARCHAR(255) NULL,
  system_id VARCHAR(255) NULL,
  assignment_id VARCHAR(255) NOT NULL,
  title VARCHAR(512) NULL,
  content LONGTEXT NULL,
  version INT NOT NULL DEFAULT 1,
  timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  submitted_at DATETIME(3) NULL,
  drive_file_id VARCHAR(255) NULL,
  drive_file_name VARCHAR(512) NULL,
  local_file_path VARCHAR(1024) NULL,
  UNIQUE KEY uq_assignments_participant_week (participant_id, assignment_id),
  KEY idx_assignments_participant_timestamp (participant_id, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  participant_id VARCHAR(255) NOT NULL,
  assignment_id VARCHAR(255) NOT NULL,
  session_id VARCHAR(255) NULL,
  system_id VARCHAR(255) NULL,
  title VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_chat_sessions_participant_assignment_updated (
    participant_id,
    assignment_id,
    updated_at
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_exchanges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  participant_id VARCHAR(255) NULL,
  session_id VARCHAR(255) NULL,
  chat_session_id BIGINT UNSIGNED NOT NULL,
  assignment_id VARCHAR(255) NOT NULL,
  system_id VARCHAR(255) NULL,
  user_input LONGTEXT NULL,
  bot_response LONGTEXT NULL,
  attachment_ids JSON NULL,
  retrieved_chunk_ids JSON NULL,
  retrieval_meta JSON NULL,
  timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_chat_exchanges_session_timestamp (chat_session_id, timestamp),
  CONSTRAINT fk_chat_exchanges_session
    FOREIGN KEY (chat_session_id) REFERENCES chat_sessions (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  participant_id VARCHAR(255) NOT NULL,
  assignment_id VARCHAR(255) NOT NULL,
  system_id VARCHAR(255) NULL,
  chat_session_id BIGINT UNSIGNED NOT NULL,
  exchange_id BIGINT UNSIGNED NULL,
  original_filename VARCHAR(512) NOT NULL,
  stored_filename VARCHAR(512) NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  status ENUM('processing', 'ready', 'failed') NOT NULL DEFAULT 'processing',
  error_message TEXT NULL,
  chunk_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_chat_attachments_session_created (chat_session_id, created_at),
  CONSTRAINT fk_chat_attachments_session
    FOREIGN KEY (chat_session_id) REFERENCES chat_sessions (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_chat_attachments_exchange
    FOREIGN KEY (exchange_id) REFERENCES chat_exchanges (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS document_chunks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  attachment_id BIGINT UNSIGNED NOT NULL,
  chat_session_id BIGINT UNSIGNED NOT NULL,
  assignment_id VARCHAR(255) NOT NULL,
  participant_id VARCHAR(255) NOT NULL,
  system_id VARCHAR(255) NULL,
  chunk_index INT NOT NULL,
  text LONGTEXT NOT NULL,
  source_filename VARCHAR(512) NOT NULL,
  page_start INT NULL,
  page_end INT NULL,
  embedding JSON NULL,
  embedding_model VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_document_chunks_session_index (chat_session_id, chunk_index),
  KEY idx_document_chunks_attachment_index (attachment_id, chunk_index),
  CONSTRAINT fk_document_chunks_attachment
    FOREIGN KEY (attachment_id) REFERENCES chat_attachments (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_document_chunks_session
    FOREIGN KEY (chat_session_id) REFERENCES chat_sessions (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_interactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  participant_id VARCHAR(255) NULL,
  assignment_id VARCHAR(255) NULL,
  system_id VARCHAR(255) NULL,
  session_id VARCHAR(255) NULL,
  event_type VARCHAR(128) NULL,
  element_name VARCHAR(255) NULL,
  event_props JSON NULL,
  client_ts DATETIME(3) NULL,
  page VARCHAR(128) NULL,
  ui_version VARCHAR(64) NULL,
  timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

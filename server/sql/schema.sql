-- Legal Reasoning AI — MariaDB / MySQL schema
-- Run once: npm run db:init
--
-- Vocabulary: a *study session* (study_sessions, study_session_id) is one
-- sitting at the computer on one memo. A *chat thread* (chat_threads,
-- chat_thread_id) is one conversation with the assistant; a sitting can hold
-- several threads and a thread can span several sittings.

CREATE TABLE IF NOT EXISTS assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  participant_id VARCHAR(255) NOT NULL,
  study_session_id VARCHAR(255) NULL,
  system_id VARCHAR(255) NULL,
  assignment_id VARCHAR(255) NOT NULL,
  title VARCHAR(512) NULL,
  content LONGTEXT NULL,
  version INT NOT NULL DEFAULT 1,
  timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- The two states the study cares about. submitted_at locks the writing;
  -- questionnaire_completed_at is stamped by the Qualtrics return redirect.
  submitted_at DATETIME(3) NULL,
  questionnaire_completed_at DATETIME(3) NULL,
  drive_file_id VARCHAR(255) NULL,
  drive_file_name VARCHAR(512) NULL,
  local_file_path VARCHAR(1024) NULL,
  UNIQUE KEY uq_assignments_participant_week (participant_id, assignment_id),
  KEY idx_assignments_participant_timestamp (participant_id, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_threads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  participant_id VARCHAR(255) NOT NULL,
  assignment_id VARCHAR(255) NOT NULL,
  study_session_id VARCHAR(255) NULL,
  system_id VARCHAR(255) NULL,
  title VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_chat_threads_participant_assignment_updated (
    participant_id,
    assignment_id,
    updated_at
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_exchanges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  participant_id VARCHAR(255) NULL,
  study_session_id VARCHAR(255) NULL,
  chat_thread_id BIGINT UNSIGNED NOT NULL,
  assignment_id VARCHAR(255) NOT NULL,
  system_id VARCHAR(255) NULL,
  user_input LONGTEXT NULL,
  -- NULL when the participant stopped the reply or the service failed; see
  -- stop_reason. The prompt itself is always kept.
  bot_response LONGTEXT NULL,
  model VARCHAR(64) NULL,
  stop_reason VARCHAR(32) NULL,
  input_tokens INT NULL,
  output_tokens INT NULL,
  -- Server-measured time from sending the request to the model until the
  -- reply (or failure) came back.
  response_ms INT NULL,
  attachment_ids JSON NULL,
  retrieved_chunk_ids JSON NULL,
  retrieval_meta JSON NULL,
  timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_chat_exchanges_thread_timestamp (chat_thread_id, timestamp),
  CONSTRAINT fk_chat_exchanges_thread
    FOREIGN KEY (chat_thread_id) REFERENCES chat_threads (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  participant_id VARCHAR(255) NOT NULL,
  assignment_id VARCHAR(255) NOT NULL,
  system_id VARCHAR(255) NULL,
  chat_thread_id BIGINT UNSIGNED NOT NULL,
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
  KEY idx_chat_attachments_thread_created (chat_thread_id, created_at),
  CONSTRAINT fk_chat_attachments_thread
    FOREIGN KEY (chat_thread_id) REFERENCES chat_threads (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_chat_attachments_exchange
    FOREIGN KEY (exchange_id) REFERENCES chat_exchanges (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS document_chunks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  attachment_id BIGINT UNSIGNED NOT NULL,
  chat_thread_id BIGINT UNSIGNED NOT NULL,
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
  KEY idx_document_chunks_thread_index (chat_thread_id, chunk_index),
  KEY idx_document_chunks_attachment_index (attachment_id, chunk_index),
  CONSTRAINT fk_document_chunks_attachment
    FOREIGN KEY (attachment_id) REFERENCES chat_attachments (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_document_chunks_thread
    FOREIGN KEY (chat_thread_id) REFERENCES chat_threads (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only interaction log. `page` holds the surface (editor / chat / window
-- / app), `element_name` the specific target. `duration_ms` and `value_num` are
-- promoted out of event_props so the headline study measures need no
-- JSON_EXTRACT. `session_seq` is monotonic within a sitting: it makes retried
-- batches idempotent and turns dropped events into visible gaps.
CREATE TABLE IF NOT EXISTS system_interactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  participant_id VARCHAR(255) NULL,
  assignment_id VARCHAR(255) NULL,
  system_id VARCHAR(255) NULL,
  study_session_id VARCHAR(255) NULL,
  session_seq INT NULL,
  event_type VARCHAR(128) NULL,
  element_name VARCHAR(255) NULL,
  event_props JSON NULL,
  duration_ms BIGINT NULL,
  value_num DOUBLE NULL,
  client_ts DATETIME(3) NULL,
  page VARCHAR(128) NULL,
  ui_version VARCHAR(64) NULL,
  timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_interactions_study_session_seq (study_session_id, session_seq),
  KEY idx_interactions_participant_assignment_ts (participant_id, assignment_id, client_ts),
  KEY idx_interactions_event_type_ts (event_type, client_ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per sitting (page load in a fresh tab). Gives the study explicit
-- start/end boundaries so "closed the browser and came back" is directly
-- visible rather than inferred.
CREATE TABLE IF NOT EXISTS study_sessions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  participant_id VARCHAR(255) NULL,
  assignment_id VARCHAR(255) NULL,
  system_id VARCHAR(255) NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  client_started_at DATETIME(3) NULL,
  last_seen_at DATETIME(3) NULL,
  ended_at DATETIME(3) NULL,
  end_reason VARCHAR(32) NULL,
  user_agent VARCHAR(512) NULL,
  screen_w INT NULL,
  screen_h INT NULL,
  viewport_w INT NULL,
  viewport_h INT NULL,
  tz_offset_min INT NULL,
  -- server clock minus client clock at session start, for correcting client_ts
  clock_skew_ms BIGINT NULL,
  KEY idx_study_sessions_participant_started (participant_id, started_at),
  KEY idx_study_sessions_assignment (assignment_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Revision history for the assignment. The assignments table keeps only the
-- latest draft; this turns the document into a timeline so frequency and size
-- of changes can be measured.
CREATE TABLE IF NOT EXISTS editor_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  study_session_id VARCHAR(64) NULL,
  participant_id VARCHAR(255) NULL,
  assignment_id VARCHAR(255) NULL,
  system_id VARCHAR(255) NULL,
  captured_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  client_ts DATETIME(3) NULL,
  reason VARCHAR(32) NULL,
  content_html LONGTEXT NULL,
  plain_text LONGTEXT NULL,
  char_count INT NULL,
  word_count INT NULL,
  content_hash CHAR(64) NULL,
  keystrokes_since_prev INT NULL,
  KEY idx_snapshots_participant_assignment_ts (participant_id, assignment_id, captured_at),
  KEY idx_snapshots_study_session (study_session_id, captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Copy/cut/paste with the actual text. `origin` classifies each paste against
-- earlier copies by the same participant: text copied out of the AI chat, out
-- of the editor, or arriving from outside the system entirely. The match uses
-- `norm_hash` (whitespace-insensitive) because the browser reports a copied
-- selection and the pasted clipboard text with different line breaks; it can be
-- recomputed at any time with `npm run study:recompute-origins`.
CREATE TABLE IF NOT EXISTS clipboard_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  study_session_id VARCHAR(64) NULL,
  participant_id VARCHAR(255) NULL,
  assignment_id VARCHAR(255) NULL,
  system_id VARCHAR(255) NULL,
  chat_thread_id BIGINT UNSIGNED NULL,
  action VARCHAR(16) NOT NULL,
  surface VARCHAR(32) NULL,
  content LONGTEXT NULL,
  char_count INT NULL,
  truncated TINYINT(1) NOT NULL DEFAULT 0,
  content_hash CHAR(64) NULL,
  norm_hash CHAR(64) NULL,
  origin VARCHAR(32) NULL,
  client_ts DATETIME(3) NULL,
  server_ts DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_clipboard_participant_assignment_ts (participant_id, assignment_id, client_ts),
  KEY idx_clipboard_hash_lookup (participant_id, content_hash, action),
  KEY idx_clipboard_norm_hash_lookup (participant_id, norm_hash, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

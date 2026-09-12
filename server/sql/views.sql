-- Analysis views for the HCI study.
-- Applied by `npm run db:init` after schema.sql.
--
-- Scalar subqueries are used throughout rather than CTEs or window functions
-- so the definitions work on both MySQL and older MariaDB. JSON booleans are
-- compared as strings for the same reason.
--
-- Every view carries the same identity columns so files can be joined
-- without thought: participant_id, assignment_id, memo_number (the numeric
-- part of assignment_id), study_condition (AI / NoAI, from system_id) and,
-- where it applies, study_session_id (the sitting) and chat_thread_id.
--
-- The event-family views (v_typing_bursts, v_heartbeats, v_attention) unpack
-- the per-event details that system_interactions keeps in event_props JSON, so
-- the export has a plain column per measure.

-- ---------------------------------------------------------------------------
-- Event families
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_typing_bursts;

CREATE VIEW v_typing_bursts AS
SELECT
    e.id,
    e.participant_id,
    e.assignment_id,
    CAST(SUBSTRING(e.assignment_id, 6) AS UNSIGNED) AS memo_number,
    CASE e.system_id WHEN '2' THEN 'AI' WHEN '1' THEN 'NoAI' END AS study_condition,
    e.study_session_id,
    e.session_seq,
    e.page AS surface,
    e.value_num AS keystrokes,
    e.duration_ms,
    CAST(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.chars')) AS SIGNED) AS chars,
    CAST(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.backspaces')) AS SIGNED) AS backspaces,
    CAST(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.deletes')) AS SIGNED) AS deletes,
    CAST(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.enters')) AS SIGNED) AS enters,
    CAST(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.navigation')) AS SIGNED) AS navigation,
    CAST(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.shortcuts')) AS SIGNED) AS shortcuts,
    CAST(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.charDelta')) AS SIGNED) AS char_delta,
    e.client_ts,
    e.timestamp AS server_ts
FROM system_interactions e
WHERE e.event_type = 'typing_burst';

DROP VIEW IF EXISTS v_heartbeats;

CREATE VIEW v_heartbeats AS
SELECT
    e.id,
    e.participant_id,
    e.assignment_id,
    CAST(SUBSTRING(e.assignment_id, 6) AS UNSIGNED) AS memo_number,
    CASE e.system_id WHEN '2' THEN 'AI' WHEN '1' THEN 'NoAI' END AS study_condition,
    e.study_session_id,
    e.session_seq,
    e.duration_ms AS interval_ms,
    CASE JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.visible'))
        WHEN 'true' THEN 1 WHEN 'false' THEN 0 END AS visible,
    CASE JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.windowFocused'))
        WHEN 'true' THEN 1 WHEN 'false' THEN 0 END AS window_focused,
    CASE JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.hadInput'))
        WHEN 'true' THEN 1 WHEN 'false' THEN 0 END AS had_input,
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.surface')), 'null') AS active_surface,
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.pointerSurface')), 'null') AS pointer_surface,
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.layout')), 'null') AS layout,
    e.client_ts,
    e.timestamp AS server_ts
FROM system_interactions e
WHERE e.event_type = 'heartbeat';

-- Focus changes. `kind` says what happened; `duration_ms` is the length of
-- the state that just ended (window_focus = time away, surface_blur = time in
-- that pane, tab_visible = time hidden, and so on).
DROP VIEW IF EXISTS v_attention;

CREATE VIEW v_attention AS
SELECT
    e.id,
    e.participant_id,
    e.assignment_id,
    CAST(SUBSTRING(e.assignment_id, 6) AS UNSIGNED) AS memo_number,
    CASE e.system_id WHEN '2' THEN 'AI' WHEN '1' THEN 'NoAI' END AS study_condition,
    e.study_session_id,
    e.session_seq,
    e.event_type AS kind,
    e.page AS surface,
    e.duration_ms,
    e.client_ts,
    e.timestamp AS server_ts
FROM system_interactions e
WHERE e.event_type IN (
    'window_blur', 'window_focus',
    'tab_hidden', 'tab_visible',
    'surface_focus', 'surface_blur'
);

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------

-- One row per prompt sent, whether or not it was answered.
DROP VIEW IF EXISTS v_chat_turns;

CREATE VIEW v_chat_turns AS
SELECT
    x.id,
    x.participant_id,
    x.assignment_id,
    CAST(SUBSTRING(x.assignment_id, 6) AS UNSIGNED) AS memo_number,
    CASE x.system_id WHEN '2' THEN 'AI' WHEN '1' THEN 'NoAI' END AS study_condition,
    x.study_session_id,
    x.chat_thread_id,
    CHAR_LENGTH(x.user_input) AS prompt_chars,
    CHAR_LENGTH(x.bot_response) AS response_chars,
    (x.bot_response IS NOT NULL) AS answered,
    x.model,
    x.stop_reason,
    x.input_tokens,
    x.output_tokens,
    x.response_ms,
    JSON_LENGTH(x.attachment_ids) AS attachment_count,
    JSON_LENGTH(x.retrieved_chunk_ids) AS retrieved_chunk_count,
    x.timestamp
FROM chat_exchanges x;

-- ---------------------------------------------------------------------------
-- Per-sitting summary
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_session_summary;

CREATE VIEW v_session_summary AS
SELECT
    s.id AS study_session_id,
    s.participant_id,
    s.assignment_id,
    CAST(SUBSTRING(s.assignment_id, 6) AS UNSIGNED) AS memo_number,
    CASE s.system_id WHEN '2' THEN 'AI' WHEN '1' THEN 'NoAI' END AS study_condition,
    s.started_at,
    s.ended_at,
    s.end_reason,
    s.last_seen_at,

    TIMESTAMPDIFF(SECOND, s.started_at,
                  COALESCE(s.ended_at, s.last_seen_at, s.started_at)) AS open_seconds,

    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'heartbeat'
        AND JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.visible')) = 'true') AS tab_visible_ms,

    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'heartbeat'
        AND JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.hadInput')) = 'true') AS input_active_ms,

    (SELECT COUNT(*)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'window_focus') AS away_episodes,

    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'window_focus') AS away_ms,

    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'surface_blur'
        AND e.page = 'editor') AS editor_focus_ms,

    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'surface_blur'
        AND e.page = 'chat') AS chat_focus_ms,

    (SELECT COALESCE(SUM(e.value_num), 0)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'typing_burst'
        AND e.page = 'editor') AS editor_keystrokes,

    (SELECT COALESCE(SUM(e.value_num), 0)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'typing_burst'
        AND e.page = 'chat') AS chat_keystrokes,

    -- Layout: time with both panes showing, or one hidden behind the divider.
    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'heartbeat'
        AND JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.layout')) = 'split') AS split_layout_ms,

    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'heartbeat'
        AND JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.layout')) = 'editor_max') AS editor_max_ms,

    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'heartbeat'
        AND JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.layout')) = 'chat_max') AS chat_max_ms,

    -- Reading the chat: pixels scrolled by the student, upward (re-reading)
    -- separately, and text highlighted in replies.
    (SELECT COALESCE(SUM(e.value_num), 0)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'chat_scroll') AS chat_scroll_px,

    (SELECT COALESCE(SUM(
                CAST(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.up')) AS UNSIGNED)
            ), 0)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'chat_scroll') AS chat_scroll_up_px,

    (SELECT COUNT(*)
       FROM system_interactions e
      WHERE e.study_session_id = s.id
        AND e.event_type = 'chat_select') AS chat_selections,

    (SELECT COUNT(*)
       FROM chat_exchanges x
      WHERE x.study_session_id = s.id) AS prompts_sent,

    (SELECT COUNT(*)
       FROM editor_snapshots n
      WHERE n.study_session_id = s.id) AS snapshot_count,

    (SELECT COUNT(*)
       FROM clipboard_events c
      WHERE c.study_session_id = s.id
        AND c.action = 'paste'
        AND c.surface = 'editor'
        AND c.origin = 'internal_chat_assistant') AS ai_pastes_into_editor,

    (SELECT COUNT(*)
       FROM clipboard_events c
      WHERE c.study_session_id = s.id
        AND c.action = 'paste'
        AND c.origin = 'external') AS external_pastes

FROM study_sessions s;

-- ---------------------------------------------------------------------------
-- Per-participant-per-memo summary: the file most analyses start from
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_participant_week;

CREATE VIEW v_participant_week AS
SELECT
    s.participant_id,
    s.assignment_id,
    CAST(SUBSTRING(s.assignment_id, 6) AS UNSIGNED) AS memo_number,

    -- Mode for the week. Reported as a list so a participant who somehow saw
    -- both conditions is visible rather than silently averaged.
    (SELECT GROUP_CONCAT(DISTINCT x.system_id ORDER BY x.system_id)
       FROM study_sessions x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id) AS system_ids,

    -- A simple CASE cannot match NULL, so the "no condition recorded" case is
    -- tested separately; otherwise it would read as 'mixed'.
    CASE
        WHEN COALESCE(
                (SELECT GROUP_CONCAT(DISTINCT x.system_id ORDER BY x.system_id)
                   FROM study_sessions x
                  WHERE x.participant_id = s.participant_id
                    AND x.assignment_id = s.assignment_id),
                (SELECT a.system_id FROM assignments a
                  WHERE a.participant_id = s.participant_id
                    AND a.assignment_id = s.assignment_id LIMIT 1)) IS NULL
            THEN NULL
        ELSE CASE COALESCE(
                (SELECT GROUP_CONCAT(DISTINCT x.system_id ORDER BY x.system_id)
                   FROM study_sessions x
                  WHERE x.participant_id = s.participant_id
                    AND x.assignment_id = s.assignment_id),
                (SELECT a.system_id FROM assignments a
                  WHERE a.participant_id = s.participant_id
                    AND a.assignment_id = s.assignment_id LIMIT 1))
            WHEN '2' THEN 'AI'
            WHEN '1' THEN 'NoAI'
            ELSE 'mixed'
        END
    END AS study_condition,

    -- Progress ------------------------------------------------------------
    COALESCE(
        (SELECT CASE
                    WHEN a.submitted_at IS NULL THEN 'writing'
                    WHEN a.questionnaire_completed_at IS NULL THEN 'questionnaire'
                    ELSE 'complete'
                END
           FROM assignments a
          WHERE a.participant_id = s.participant_id
            AND a.assignment_id = s.assignment_id
          LIMIT 1),
        'writing') AS state,

    (SELECT a.submitted_at
       FROM assignments a
      WHERE a.participant_id = s.participant_id
        AND a.assignment_id = s.assignment_id
      LIMIT 1) AS submitted_at,

    (SELECT a.questionnaire_completed_at
       FROM assignments a
      WHERE a.participant_id = s.participant_id
        AND a.assignment_id = s.assignment_id
      LIMIT 1) AS questionnaire_completed_at,

    -- Sittings ------------------------------------------------------------
    (SELECT COUNT(*)
       FROM study_sessions x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id) AS session_count,

    (SELECT MIN(x.started_at)
       FROM study_sessions x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id) AS first_started_at,

    (SELECT MAX(COALESCE(x.ended_at, x.last_seen_at))
       FROM study_sessions x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id) AS last_activity_at,

    -- Wall-clock time the app was open. Sessions whose close beacon was lost
    -- fall back to last_seen_at, which is refreshed on every event batch.
    (SELECT COALESCE(SUM(
                TIMESTAMPDIFF(SECOND, x.started_at,
                              COALESCE(x.ended_at, x.last_seen_at, x.started_at))
            ), 0)
       FROM study_sessions x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id) AS open_seconds,

    -- Attention -----------------------------------------------------------
    -- Upper bound on engagement: tab was visible.
    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'heartbeat'
        AND JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.visible')) = 'true'
    ) AS tab_visible_ms,

    -- Lower bound on engagement: keyboard, scroll or selection activity.
    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'heartbeat'
        AND JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.hadInput')) = 'true'
    ) AS input_active_ms,

    -- window_focus carries the length of the away period that just ended.
    (SELECT COUNT(*)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'window_focus') AS away_episodes,

    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'window_focus') AS away_ms,

    (SELECT COUNT(*)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'tab_hidden') AS tab_switch_count,

    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'tab_visible') AS tab_hidden_ms,

    -- Pane dwell ----------------------------------------------------------
    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'surface_blur'
        AND e.page = 'editor') AS editor_focus_ms,

    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'surface_blur'
        AND e.page = 'chat') AS chat_focus_ms,

    -- Typing effort -------------------------------------------------------
    (SELECT COALESCE(SUM(e.value_num), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'typing_burst'
        AND e.page = 'editor') AS editor_keystrokes,

    (SELECT COALESCE(SUM(e.value_num), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'typing_burst'
        AND e.page = 'chat') AS chat_keystrokes,

    (SELECT COALESCE(SUM(
                CAST(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.backspaces')) AS UNSIGNED)
            ), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'typing_burst'
        AND e.page = 'editor') AS editor_backspaces,

    (SELECT COALESCE(SUM(
                CAST(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.shortcuts')) AS UNSIGNED)
            ), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'typing_burst'
        AND e.page = 'editor') AS editor_shortcuts,

    -- Number of 10s windows containing typing: a proxy for how spread out the
    -- writing was rather than how much of it there was.
    (SELECT COUNT(*)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'typing_burst'
        AND e.page = 'editor') AS editor_typing_buckets,

    -- Layout ---------------------------------------------------------------
    -- Time with both panes showing, or with one hidden behind the divider.
    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'heartbeat'
        AND JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.layout')) = 'split') AS split_layout_ms,

    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'heartbeat'
        AND JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.layout')) = 'editor_max') AS editor_max_ms,

    (SELECT COALESCE(SUM(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'heartbeat'
        AND JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.layout')) = 'chat_max') AS chat_max_ms,

    (SELECT COUNT(*)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'layout_change') AS layout_changes,

    -- Reading the chat ----------------------------------------------------
    -- Pixels the student scrolled in the chat, with upward (re-reading)
    -- scrolling separately, and how often they highlighted text in a reply.
    (SELECT COALESCE(SUM(e.value_num), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'chat_scroll') AS chat_scroll_px,

    (SELECT COALESCE(SUM(
                CAST(JSON_UNQUOTE(JSON_EXTRACT(e.event_props, '$.up')) AS UNSIGNED)
            ), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'chat_scroll') AS chat_scroll_up_px,

    (SELECT COUNT(*)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'chat_select') AS chat_selections,

    -- AI use --------------------------------------------------------------
    (SELECT COUNT(*)
       FROM chat_exchanges x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id) AS prompts_sent,

    (SELECT COUNT(*)
       FROM chat_exchanges x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id
        AND x.bot_response IS NOT NULL) AS prompts_answered,

    (SELECT COUNT(*)
       FROM chat_exchanges x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id
        AND x.stop_reason = 'aborted') AS prompts_stopped,

    (SELECT COALESCE(AVG(x.response_ms), 0)
       FROM chat_exchanges x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id
        AND x.bot_response IS NOT NULL) AS mean_response_ms,

    (SELECT COALESCE(SUM(CHAR_LENGTH(x.user_input)), 0)
       FROM chat_exchanges x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id) AS total_prompt_chars,

    (SELECT COALESCE(SUM(CHAR_LENGTH(x.bot_response)), 0)
       FROM chat_exchanges x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id) AS total_response_chars,

    (SELECT COALESCE(SUM(x.input_tokens), 0)
       FROM chat_exchanges x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id) AS input_tokens,

    (SELECT COALESCE(SUM(x.output_tokens), 0)
       FROM chat_exchanges x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id) AS output_tokens,

    (SELECT COUNT(*)
       FROM chat_threads t
      WHERE t.participant_id = s.participant_id
        AND t.assignment_id = s.assignment_id) AS chat_thread_count,

    (SELECT COUNT(*)
       FROM chat_attachments a
      WHERE a.participant_id = s.participant_id
        AND a.assignment_id = s.assignment_id) AS attachment_count,

    -- Document evolution --------------------------------------------------
    (SELECT COUNT(*)
       FROM editor_snapshots n
      WHERE n.participant_id = s.participant_id
        AND n.assignment_id = s.assignment_id) AS snapshot_count,

    (SELECT n.word_count
       FROM editor_snapshots n
      WHERE n.participant_id = s.participant_id
        AND n.assignment_id = s.assignment_id
      ORDER BY n.captured_at DESC, n.id DESC
      LIMIT 1) AS final_word_count,

    -- Clipboard -----------------------------------------------------------
    (SELECT COUNT(*)
       FROM clipboard_events c
      WHERE c.participant_id = s.participant_id
        AND c.assignment_id = s.assignment_id
        AND c.action = 'paste'
        AND c.surface = 'editor'
        AND c.origin = 'internal_chat_assistant') AS ai_pastes_into_editor,

    (SELECT COALESCE(SUM(c.char_count), 0)
       FROM clipboard_events c
      WHERE c.participant_id = s.participant_id
        AND c.assignment_id = s.assignment_id
        AND c.action = 'paste'
        AND c.surface = 'editor'
        AND c.origin = 'internal_chat_assistant') AS ai_chars_into_editor,

    -- Text that was never copied inside the system: arrived from another tab,
    -- a document, or another AI tool.
    (SELECT COUNT(*)
       FROM clipboard_events c
      WHERE c.participant_id = s.participant_id
        AND c.assignment_id = s.assignment_id
        AND c.action = 'paste'
        AND c.origin = 'external') AS external_pastes,

    (SELECT COALESCE(SUM(c.char_count), 0)
       FROM clipboard_events c
      WHERE c.participant_id = s.participant_id
        AND c.assignment_id = s.assignment_id
        AND c.action = 'paste'
        AND c.origin = 'external') AS external_paste_chars

-- Every participant/memo pair that left any trace gets a row; pairs with no
-- activity at all are deliberately absent so averages are over participants
-- who actually did the memo.
FROM (
    SELECT participant_id, assignment_id FROM study_sessions
     WHERE participant_id IS NOT NULL AND assignment_id IS NOT NULL
    UNION
    SELECT participant_id, assignment_id FROM system_interactions
     WHERE participant_id IS NOT NULL AND assignment_id IS NOT NULL
    UNION
    SELECT participant_id, assignment_id FROM assignments
     WHERE participant_id IS NOT NULL AND assignment_id IS NOT NULL
) AS s;

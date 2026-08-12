-- Analysis views for the HCI study.
-- Applied by `npm run db:init` after schema.sql.
--
-- Scalar subqueries are used throughout rather than derived tables or CTEs so
-- the view definitions work on both MySQL and older MariaDB. JSON booleans are
-- compared as strings for the same reason.

DROP VIEW IF EXISTS v_participant_week;

CREATE VIEW v_participant_week AS
SELECT
    s.participant_id,
    s.assignment_id,

    -- Mode for the week. Reported as a list so a participant who somehow saw
    -- both conditions is visible rather than silently averaged.
    (SELECT GROUP_CONCAT(DISTINCT x.system_id ORDER BY x.system_id)
       FROM study_sessions x
      WHERE x.participant_id = s.participant_id
        AND x.assignment_id = s.assignment_id) AS system_ids,

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

    -- Number of 10s windows containing typing: a proxy for how spread out the
    -- writing was rather than how much of it there was.
    (SELECT COUNT(*)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'typing_burst'
        AND e.page = 'editor') AS editor_typing_buckets,

    -- AI use --------------------------------------------------------------
    (SELECT COUNT(*)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'chat_send') AS prompts_sent,

    (SELECT COALESCE(AVG(e.duration_ms), 0)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'chat_response') AS mean_response_ms,

    (SELECT COUNT(*)
       FROM system_interactions e
      WHERE e.participant_id = s.participant_id
        AND e.assignment_id = s.assignment_id
        AND e.event_type = 'chat_stop') AS generations_stopped,

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
        AND c.origin = 'external') AS external_paste_chars,

    -- Submission ----------------------------------------------------------
    (SELECT a.submitted_at
       FROM assignments a
      WHERE a.participant_id = s.participant_id
        AND a.assignment_id = s.assignment_id
      LIMIT 1) AS submitted_at

FROM (
    SELECT DISTINCT participant_id, assignment_id FROM study_sessions
) AS s;

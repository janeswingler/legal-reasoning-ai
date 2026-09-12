# What the system records

This document describes everything the study platform logs, what can be
measured from it, and what cannot. It is written to be readable without a
computer science background; the technical column names are included so an
analyst can find each variable in the exported files.

Participants work in a two-pane app: an AI chat on the left (in AI weeks) and an
assignment editor on the right. Each week a participant is in one of two modes,
recorded as `system_id`: **1** = editor only, no AI. **2** = editor plus AI chat.

---

## The short version

We record four kinds of thing:

1. **The work itself** — the assignment draft, saved continuously, plus a
   revision history that shows how it grew over time.
2. **The conversation** — every prompt the participant sent and every AI reply,
   in full, with any PDFs they attached.
3. **Attention** — when the study window was in front of them, when they
   switched away and for how long, and whether they were in the editor or the
   chat at any moment.
4. **Effort and text movement** — how many keys they pressed and where, and the
   actual text of everything they copied and pasted, including whether pasted
   text came from the AI, from their own draft, or from outside the system.

Everything is timestamped to the millisecond and tied to a **study session**,
meaning one sitting at the computer on one memo (column `study_session_id`).
Closing the browser and coming back later produces a new session, so gaps in
work are visible. A page reload does not: the sitting simply continues.

A **chat thread** (`chat_thread_id`) is one conversation with the assistant. A
sitting can hold several threads, and a thread can be continued across
sittings. The two are always named distinctly in the data.

Every table and export carries the same identity columns — `participant_id`,
`assignment_id` (memo), `study_session_id` where it applies — so files can be
joined directly. The summary and analysis views also add `memo_number` (the
numeric part of `assignment_id`) and `study_condition` (`AI` / `NoAI`).

Timestamps are stored in UTC and written to the export in **Pacific time**, in
the form `2026-09-08T14:03:00.123-07:00` (the trailing offset is `-07:00` in
summer and `-08:00` in winter, so values on either side of the daylight-saving
change still sort and subtract correctly).

Which mode a participant is in is decided on the server from the study's
condition mapping, for every request. The `system_id` recorded on any row is
that server-side value, never something the browser reported.

---

## Getting the data out

```
npm run study:export
```

This writes a folder of CSV files that open directly in Excel, R or SPSS.

| File | One row per… | Use it for |
| --- | --- | --- |
| `participant_week_summary.csv` | participant × memo | **Start here.** All headline measures, already computed |
| `session_summary.csv` | sitting | The same measures at the sitting level, for models with a sitting term |
| `typing_bursts.csv` | 10-second typing window | Keystrokes, characters, backspaces, deletions, shortcuts, net length change |
| `heartbeats.csv` | 30-second heartbeat | Whether the tab was visible, the window focused, and any input occurred |
| `attention.csv` | focus change | Away episodes, tab switches, time in the editor vs. the chat |
| `chat_turns.csv` | prompt sent | Prompt and reply length, whether answered, model, tokens, wait time |
| `study_sessions.csv`, `events.csv`, `clipboard_events.csv`, `editor_snapshots.csv`, `assignments.csv`, `chat_threads.csv`, `chat_exchanges.csv`, `chat_attachments.csv` | raw record | The records behind the numbers above, including all text |

The first six are produced by database *views* — saved queries that unpack the
per-event details into plain columns — so nothing in them needs parsing.

Two Python scripts (they need `pandas`; `scipy` is optional) take it from there:

```
python scripts/check-export.py analysis/<export folder>
python scripts/build-memo-table.py analysis/<export folder>
```

The first checks an export for problems: every file loads, timestamps are
Pacific, conditions match the mapping, no-AI weeks have no chat activity, and
each summary number agrees with the raw records it was computed from. The
second writes `memo_level.csv`, one row for every scheduled student-memo pair
with group, condition, due date, lateness, and every engagement measure, and
merges in `grades.csv` (rubric scores) and `qualtrics.csv` (survey and quiz
scores) if those are placed in the same folder with `participant_id` and
`memo_number` columns. That single table is the one every analysis runs from.
Test participants (ids 20001–20020) are excluded from it.

---

## Table by table

### `study_sessions` — one row per sitting

| Column | Meaning |
| --- | --- |
| `id` | Unique id for this sitting |
| `participant_id`, `assignment_id`, `system_id` | Who, which week, which mode |
| `started_at`, `ended_at` | When the sitting began and ended |
| `end_reason` | How it ended, normally closing the tab |
| `last_seen_at` | Last moment of confirmed activity, used when a browser is closed abruptly and the closing signal is lost |
| `viewport_w/h`, `screen_w/h` | Window and monitor size |
| `tz_offset_min` | Participant's time zone |
| `clock_skew_ms` | Difference between the participant's clock and the server's, so timestamps from different machines can be compared fairly |

### `system_interactions` — the event log

One row per recorded action. The important columns are `event_type` (what
happened), `page` (where: `editor`, `chat`, `window`, `app`), `duration_ms` (how
long, for events that describe a period of time) and `value_num` (the single
number the event is about).

| `event_type` | What it means | What is in `duration_ms` / `value_num` |
| --- | --- | --- |
| `session_start` | App opened. `isNewSession: false` in the details means a page refresh rather than a fresh arrival; `resumed: "bfcache"` means the browser brought the page back from its back/forward cache | — |
| _(no event)_ | App closing is not written to this table. It is recorded on the sitting itself, as `ended_at` and `end_reason` in `study_sessions` | — |
| `heartbeat` | Emitted every 30 seconds. Details record whether the tab was visible, whether the window had focus, whether there was any activity, which pane was active, where the mouse pointer was resting, and the layout (`split`, `editor_max`, `chat_max`, or `editor_only` in no-AI weeks) | Length of the interval |
| `window_blur` | Participant moved to another application or window | How long they had been present |
| `window_focus` | Participant came back | **How long they were away** |
| `tab_hidden` / `tab_visible` | Switched to another browser tab and back | Time in the previous state |
| `surface_focus` / `surface_blur` | Started or stopped using the editor or the chat pane. A pane counts as in use from the moment the participant clicks, scrolls, types, or selects text in it until they do one of those things in the other pane, so time spent reading a reply after sending a prompt counts as chat time. Details give what started it (`pointer`, `scroll`, `keyboard`, `focus`, `selection`, or `resume` after coming back to the window). The clock pauses while the window or tab is in the background | Time spent in that pane |
| `chat_scroll` / `editor_scroll` | A 10-second window containing scrolling by the participant. Details give the distance scrolled up (re-reading) and down, whether they ended at the bottom, and for the chat which message was in the middle of the view at the end and how many messages there were. Scrolling the page does on its own, such as bringing a new reply into view, is counted in `programmatic` and never as attention | `value_num` = pixels scrolled |
| `chat_select` | Participant highlighted text in a chat message. Details say whether it was in an AI reply or their own prompt | `value_num` = characters highlighted |
| `layout_change` | Participant hid or restored one pane using the divider's arrow buttons or the keyboard shortcuts, or dragged a hidden pane back. Details give the new mode, the previous mode, and how it was done | `value_num` = chat share of the width (0 to 1) |
| `typing_burst` | A 10-second window containing typing. Details break it into characters, backspaces, deletes, Enter presses, arrow keys, keyboard shortcuts (Ctrl/Cmd combinations such as undo or paste, which are not counted as characters), and the net change in length | `value_num` = number of keys pressed |
| `chat_send` | A prompt was sent | `value_num` = prompt length in characters |
| `chat_response` | A reply arrived | Time the participant waited |
| `chat_stop` | Participant cancelled a reply mid-generation | — |
| `chat_thread_switch` | Moved between conversation threads | — |
| `chat_new` | Started a new conversation | — |
| `attachment_add` | Uploaded a PDF to the chat | File size |
| `submit_confirm_open` / `submit_confirm_cancel` | Opened the "are you sure?" dialog before submitting, or backed out of it | — |
| `submit` / `export_pdf` | Submitted or downloaded the assignment | Length of the document |
| `qualtrics_continue` / `qualtrics_defer` | After submitting, went on to the questionnaire now or chose to do it later | — |
| `connection_lost` / `connection_restored` | The draft stopped saving (details give the reason: the browser reported it was offline, a save got no answer or an error, or the memo could not be loaded) and when saving worked again. A red banner is shown to the participant in between | — |
| `split_resize` | Dragged the divider between chat and editor, or reset it | Proportion given to the chat |
| `viewport_resize` | Resized the window | — |
| `sidebar_toggle` | Showed or hid the conversation list | — |

Each event also carries a `session_seq` number that counts up within a sitting.
Because it never skips, a gap in the numbering would reveal that an event failed
to reach the server. **In testing there were no gaps.**

### `editor_snapshots` — how the draft evolved

A copy of the assignment is stored at most every 30 seconds while it is being
changed, and always when the participant leaves the editor, submits, exports, or
switches to another tab or window. (Closing the tab outright is too late for a
document-sized request, so the last change before a close is captured by the
preceding interval or tab switch.) Snapshots identical to the one before are
discarded, so idle time does not fill the table.

| Column | Meaning |
| --- | --- |
| `captured_at`, `reason` | When, and what prompted the capture |
| `plain_text`, `content_html` | The draft at that moment, as text and with formatting. The text is derived from the formatting on the server, with one line per paragraph |
| `char_count`, `word_count` | Size at that moment |
| `keystrokes_since_prev` | How much typing happened since the previous snapshot |

This is what makes "frequency of changes" answerable. Previously only the final
draft was kept.

### `clipboard_events` — copied and pasted text

| Column | Meaning |
| --- | --- |
| `action` | `copy`, `cut` or `paste` |
| `surface` | Where it happened: the editor, the chat box, or a chat message (with the AI's messages distinguished from the participant's own) |
| `content` | **The actual text**, up to 20,000 characters |
| `char_count`, `truncated` | True length, and whether the stored copy was shortened |
| `origin` | For pastes only, see below |

`origin` is worked out by checking whether the pasted text was ever copied
inside the system. The comparison ignores differences in spacing and line
breaks, because browsers report a copied selection and the pasted clipboard
text slightly differently. It can be recomputed from the stored text at any
time with `npm run study:recompute-origins`; do this once before analysis so
the classification does not depend on the order in which events reached the
server.

- `internal_chat_assistant` — **copied out of an AI reply.** The clearest
  measure of AI text being adopted into the assignment.
- `internal_chat_user` — copied from the participant's own prompt
- `internal_editor` — moved around within their own draft
- `external` — **never copied anywhere in this system**, so it came from another
  tab, a document, or another AI tool
- `unknown` — text too short (under 8 characters) to attribute confidently

### `assignments`, `chat_threads`, `chat_exchanges`, `chat_attachments`

`assignments` holds the current draft and submission details. `chat_threads`
is the list of conversations. `chat_exchanges` holds every prompt and reply in
full, along with which parts of any uploaded PDF the AI drew on, plus:

| Column | Meaning |
| --- | --- |
| `model` | The exact model that answered (for the methods section) |
| `stop_reason` | Why generation ended: `end_turn` (normal), `max_tokens` (cut off), `aborted` (participant pressed stop), `error`, or `empty` |
| `input_tokens`, `output_tokens` | Size of what was sent to and received from the model |
| `response_ms` | How long the model took, measured on the server |

A prompt whose reply was stopped by the participant, or never arrived because
the service failed, is still stored with an empty `bot_response`.

### `v_participant_week` — the summary table

One row per participant per week, combining all of the above: condition,
progress state, time open, time away, editor versus chat time, keystrokes in
each, time in each layout (both panes, editor only, chat only) and how often the
layout was changed, chat scrolling and re-reading distance, text highlighted in
replies, prompts sent / answered / stopped, average response wait, tokens,
snapshot count, final word count, characters pasted in from the AI, external
pastes, and submission time. This is the file to start from. Only participant/memo pairs
with some activity appear, so averages are over people who did the memo.

`v_session_summary` gives the same core measures per sitting.

---

## What can be measured

- Total time the system was open, per sitting and per week
- Time away from the study window, as a count of episodes and total duration
- Time using the editor versus the chat, where using the chat includes reading
  replies, not only typing prompts
- Time with one pane hidden and the other filling the window
- How much a participant scrolled back through earlier replies, and how often
  they highlighted text in a reply
- Total keystrokes in the editor and in the chat, and how they were distributed
  across the session
- Ratio of deletions to insertions, as a rough measure of revision
- Number and frequency of changes to the document, with a 30-second revision
  timeline and a word-count growth curve
- Every prompt and reply in full, with prompt length, reply length, and how long
  the participant waited
- Prompts that were typed but never sent, and replies cancelled mid-generation
- The exact text copied and pasted, and in which direction
- How much text moved from the AI chat into the assignment
- Text pasted in from outside the system
- When a participant closed the browser and when they came back
- Screen size and how they chose to divide the window between chat and editor
- All of the above compared between AI and no-AI weeks

### Two ways to count "time on task"

Reading an AI reply involves no typing, so a single activity number would either
count reading as work or count it as idleness. The summary reports both bounds
and the truth lies between them:

- `tab_visible_ms` — **upper bound.** The tab was in front of them.
- `input_active_ms` — **lower bound.** There was typing, scrolling or text
  selection in that interval.

---

## What cannot be measured

- **What participants did while away.** We know they left and for how long, not
  where they went.
- **Whether an AI reply was read.** We know it was displayed and how long the
  chat pane had focus. That is attention, not comprehension.
- **Where an external paste came from.** We can tell text was not copied inside
  the system. We cannot tell whether it came from another AI, a case, or their
  own notes.
- **Attention within a visible pane.** There is no mouse tracking or eye
  tracking, so we cannot tell where on screen someone was looking.
- **Anything typed in another application.**
- **Pauses shorter than about 10 seconds.** Keystrokes are counted in 10-second
  blocks, so fine-grained pause analysis of the kind used in writing-process
  research is not currently possible. See the note below.
- **Character-level edits between snapshots.** If a paragraph is written and
  deleted inside one 30-second window, only the net result survives.
- **Two windows open at once.** Each tab is treated as its own sitting, so
  overlapping time would be counted twice. This should be rare, and duplicate
  sessions with overlapping timestamps can be filtered during analysis.
- **Use on a second device**, unless the participant uses the same study link.

---

## If finer typing data is wanted later

Millisecond-level pause analysis (pauses before words, sentences and paragraphs)
would require recording the gaps between individual keystrokes. That can be
added inside the existing `typing_burst` records without any change to the
database structure and without ever recording which keys were pressed. It was
deliberately left out of this version pending approval.

---

## Privacy

Pasted text and full document snapshots are participant-authored content, and
copied text may include material from outside the study. Both should be covered
by the IRB protocol, with a stated retention period and a plan for deletion at
the end of the study. Exported CSV files contain this content in plain text and
must not be committed to version control or shared outside the research team;
the `exports/` folder is excluded from the repository for that reason.

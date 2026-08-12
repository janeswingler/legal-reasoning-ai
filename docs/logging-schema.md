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

Everything is timestamped to the millisecond and tied to a **session**, meaning
one sitting at the computer. Closing the browser and coming back later produces
a new session, so gaps in work are visible.

---

## Getting the data out

```
npm run study:export
```

This writes a folder of CSV files that open directly in Excel, R or SPSS. The
file most analyses will start from is `participant_week_summary.csv`, which has
one row per participant per week with the headline measures already computed.
The other files hold the raw records behind those numbers.

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
| `session_start` | App opened. `isNewSession: false` in the details means a page refresh rather than a fresh arrival | — |
| `session_end` | App closed | — |
| `heartbeat` | Emitted every 30 seconds. Details record whether the tab was visible, whether the window had focus, and whether there was any activity | Length of the interval |
| `window_blur` | Participant moved to another application or window | How long they had been present |
| `window_focus` | Participant came back | **How long they were away** |
| `tab_hidden` / `tab_visible` | Switched to another browser tab and back | Time in the previous state |
| `surface_focus` / `surface_blur` | Moved into or out of the editor or the chat box | Time spent in that pane |
| `typing_burst` | A 10-second window containing typing. Details break it into characters, backspaces, deletes, Enter presses, arrow keys, and the net change in length | `value_num` = number of keys pressed |
| `chat_send` | A prompt was sent | `value_num` = prompt length in characters |
| `chat_response` | A reply arrived | Time the participant waited |
| `chat_stop` | Participant cancelled a reply mid-generation | — |
| `chat_session_switch` | Moved between conversation threads | — |
| `chat_new` | Started a new conversation | — |
| `attachment_add` | Uploaded a PDF to the chat | File size |
| `submit` / `export_pdf` | Submitted or downloaded the assignment | Length of the document |
| `split_resize` | Dragged the divider between chat and editor | Proportion given to the chat |
| `viewport_resize` | Resized the window | — |
| `sidebar_toggle` | Showed or hid the conversation list | — |

Each event also carries a `session_seq` number that counts up within a sitting.
Because it never skips, a gap in the numbering would reveal that an event failed
to reach the server. **In testing there were no gaps.**

### `editor_snapshots` — how the draft evolved

A copy of the assignment is stored at most every 30 seconds while it is being
changed, and always when the participant leaves the editor, submits, exports, or
closes the tab. Snapshots identical to the one before are discarded, so idle
time does not fill the table.

| Column | Meaning |
| --- | --- |
| `captured_at`, `reason` | When, and what prompted the capture |
| `plain_text`, `content_html` | The draft at that moment, as text and with formatting |
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
inside the system:

- `internal_chat_assistant` — **copied out of an AI reply.** The clearest
  measure of AI text being adopted into the assignment.
- `internal_chat_user` — copied from the participant's own prompt
- `internal_editor` — moved around within their own draft
- `external` — **never copied anywhere in this system**, so it came from another
  tab, a document, or another AI tool
- `unknown` — text too short (under 8 characters) to attribute confidently

### `assignments`, `chat_sessions`, `chat_exchanges`, `chat_attachments`

Unchanged from before. `assignments` holds the current draft and submission
details. `chat_exchanges` holds every prompt and reply in full, along with which
parts of any uploaded PDF the AI drew on.

### `v_participant_week` — the summary table

One row per participant per week, combining all of the above: time open, time
away, editor versus chat time, keystrokes in each, prompts sent, average
response wait, snapshot count, final word count, characters pasted in from the
AI, external pastes, and submission time. This is the file to start from.

---

## What can be measured

- Total time the system was open, per sitting and per week
- Time away from the study window, as a count of episodes and total duration
- Time with the editor focused versus the chat focused
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

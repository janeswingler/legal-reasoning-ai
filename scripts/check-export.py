"""
Sanity checks and a first look at a study export.

    python scripts/check-export.py analysis/2026-09-12T22-14-48

Reads every CSV the export produced, checks that they agree with each other,
flags anything that would get in the way of analysis, and prints the basic
AI vs no-AI comparison the study will eventually run for real.
"""
import sys
from pathlib import Path

import pandas as pd

pd.set_option("display.width", 160)
pd.set_option("display.max_columns", 40)

folder = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
TEST_IDS = {str(i) for i in range(20001, 20021)}

problems = []
notes = []


def problem(text):
    problems.append(text)
    print(f"  PROBLEM  {text}")


def ok(text):
    print(f"  ok       {text}")


def note(text):
    notes.append(text)
    print(f"  note     {text}")


# --------------------------------------------------------------- load
print("\n=== 1. Loading files ===")
files = {}
for path in sorted(p for p in folder.glob("*.csv") if p.stem not in {"memo_level", "grades", "qualtrics"}):
    try:
        df = pd.read_csv(path, dtype={"participant_id": str, "assignment_id": str,
                                       "study_session_id": str, "system_id": str})
        files[path.stem] = df
        print(f"  {path.stem:26s} {len(df):5d} rows  {len(df.columns):3d} columns")
    except Exception as e:  # noqa: BLE001
        problem(f"{path.name} would not load: {e}")

expected = ["participant_week_summary", "session_summary", "typing_bursts", "heartbeats",
            "attention", "chat_turns", "study_sessions", "events", "clipboard_events",
            "assignments", "chat_threads", "chat_exchanges", "chat_attachments",
            "editor_snapshots"]
missing = [f for f in expected if f not in files]
if missing:
    problem(f"missing files: {missing}")
else:
    ok("all 14 files present")

summary = files["participant_week_summary"]
sessions = files["study_sessions"]
events = files["events"]
heartbeats = files["heartbeats"]
attention = files["attention"]
typing = files["typing_bursts"]
exchanges = files["chat_exchanges"]
threads = files["chat_threads"]
clipboard = files["clipboard_events"]
snapshots = files["editor_snapshots"]
assignments = files["assignments"]

# --------------------------------------------------------------- timestamps
print("\n=== 2. Timestamps ===")


def parse_ts(series):
    return pd.to_datetime(series, utc=True, errors="coerce", format="ISO8601")


sample = events["client_ts"].dropna().head(3).tolist()
print(f"  example client timestamps: {sample}")
offsets = events["client_ts"].dropna().str[-6:].value_counts()
print(f"  offsets seen: {offsets.to_dict()}")
if set(offsets.index) - {"-07:00", "-08:00"}:
    problem("timestamps are not all Pacific time")
else:
    ok("all timestamps carry a Pacific offset")

bad = events["client_ts"].notna() & parse_ts(events["client_ts"]).isna()
if bad.any():
    problem(f"{bad.sum()} client timestamps do not parse")
else:
    ok("every client timestamp parses")

# --------------------------------------------------------------- identity
print("\n=== 3. Identity columns ===")
ids_by_file = {name: set(df["participant_id"].dropna().unique())
               for name, df in files.items() if "participant_id" in df.columns}
all_ids = set().union(*ids_by_file.values())
print(f"  participants seen: {sorted(all_ids)}")
non_test = all_ids - TEST_IDS
if non_test:
    note(f"real participant ids present: {sorted(non_test)}")
else:
    ok("only test ids present (20001-20020)")

for name, df in files.items():
    if "participant_id" in df.columns and df["participant_id"].isna().any():
        problem(f"{name}: {df['participant_id'].isna().sum()} rows with no participant_id")
    if "assignment_id" in df.columns and df["assignment_id"].isna().any():
        problem(f"{name}: {df['assignment_id'].isna().sum()} rows with no assignment_id")
ok("checked every file for blank participant / memo ids")

memos = set(events["assignment_id"].dropna().unique())
print(f"  memos seen: {sorted(memos)}")

# --------------------------------------------------------------- conditions
print("\n=== 4. Conditions ===")
cond = summary.set_index("participant_id")["study_condition"]
print(summary[["participant_id", "assignment_id", "study_condition", "state"]].to_string(index=False))

expected_cond = {}
for pid in all_ids:
    if pid in TEST_IDS:
        n = int(pid)
        expected_cond[pid] = "NoAI" if n <= 20010 else "AI"  # memo 1 pattern for test ids
for pid, c in cond.items():
    exp = expected_cond.get(pid)
    if exp and c != exp:
        problem(f"participant {pid} recorded as {c}, mapping says {exp} on memo 1")
if not any("recorded as" in p for p in problems):
    ok("every test participant's condition matches the mapping")

mixed = summary[summary["study_condition"] == "mixed"]
if len(mixed):
    problem(f"{len(mixed)} participant-memo rows saw both conditions: {mixed['participant_id'].tolist()}")
else:
    ok("no participant saw both conditions in one memo")

noai = summary[summary["study_condition"] == "NoAI"]
leak = noai[(noai["prompts_sent"] > 0) | (noai["chat_thread_count"] > 0) | (noai["chat_focus_ms"] > 0)]
if len(leak):
    problem(f"NoAI participants with chat activity: {leak['participant_id'].tolist()}")
else:
    ok("NoAI participants have zero chat activity")

# --------------------------------------------------------------- sessions and sequence
print("\n=== 5. Sittings and event ordering ===")
print(f"  sittings: {len(sessions)}; without an end time: {sessions['ended_at'].isna().sum()}")
print(f"  end reasons: {sessions['end_reason'].value_counts(dropna=False).to_dict()}")

gaps = 0
dups = 0
for sid, grp in events.dropna(subset=["study_session_id"]).groupby("study_session_id"):
    seqs = grp["session_seq"].dropna().astype(int).sort_values().tolist()
    if not seqs:
        continue
    if len(seqs) != len(set(seqs)):
        dups += 1
    expected_seqs = set(range(min(seqs), max(seqs) + 1))
    gaps += len(expected_seqs - set(seqs))
if dups:
    problem(f"{dups} sittings have duplicate sequence numbers")
else:
    ok("no duplicate sequence numbers within a sitting")
if gaps:
    note(f"{gaps} sequence numbers missing across all sittings (events that never reached the server)")
else:
    ok("no gaps in sequence numbers: nothing was lost in transit")

orphans = events[~events["study_session_id"].isin(sessions["id"])]
if len(orphans):
    problem(f"{len(orphans)} events belong to a sitting with no row in study_sessions")
else:
    ok("every event belongs to a known sitting")

# --------------------------------------------------------------- summary vs raw
print("\n=== 6. Summary numbers vs the raw records ===")


def compare(label, recomputed, column):
    merged = summary.set_index(["participant_id", "assignment_id"])[column].astype(float)
    recomputed = recomputed.reindex(merged.index).fillna(0).astype(float)
    diff = (merged - recomputed).abs()
    if (diff > 0.5).any():
        worst = diff.idxmax()
        problem(f"{label}: summary and raw disagree for {worst}: {merged[worst]} vs {recomputed[worst]}")
    else:
        ok(f"{label} matches the raw records")


key = ["participant_id", "assignment_id"]
compare("editor keystrokes",
        typing[typing["surface"] == "editor"].groupby(key)["keystrokes"].sum(), "editor_keystrokes")
compare("prompts sent", exchanges.groupby(key).size(), "prompts_sent")
compare("prompts answered",
        exchanges[exchanges["bot_response"].notna()].groupby(key).size(), "prompts_answered")
compare("tab visible time",
        heartbeats[heartbeats["visible"] == 1].groupby(key)["interval_ms"].sum(), "tab_visible_ms")
compare("input-active time",
        heartbeats[heartbeats["had_input"] == 1].groupby(key)["interval_ms"].sum(), "input_active_ms")
compare("chat time",
        attention[(attention["kind"] == "surface_blur") & (attention["surface"] == "chat")]
        .groupby(key)["duration_ms"].sum(), "chat_focus_ms")
compare("editor time",
        attention[(attention["kind"] == "surface_blur") & (attention["surface"] == "editor")]
        .groupby(key)["duration_ms"].sum(), "editor_focus_ms")
compare("AI pastes into editor",
        clipboard[(clipboard["action"] == "paste") & (clipboard["surface"] == "editor")
                  & (clipboard["origin"] == "internal_chat_assistant")].groupby(key).size(),
        "ai_pastes_into_editor")
compare("snapshot count", snapshots.groupby(key).size(), "snapshot_count")
compare("sitting count", sessions.groupby(key).size(), "session_count")

# --------------------------------------------------------------- content
print("\n=== 7. Content checks ===")
print(f"  clipboard origins: {clipboard[clipboard['action'] == 'paste']['origin'].value_counts(dropna=False).to_dict()}")
print(f"  chat stop reasons: {exchanges['stop_reason'].value_counts(dropna=False).to_dict()}")
print(f"  models used: {exchanges['model'].dropna().unique().tolist()}")
unanswered = exchanges["bot_response"].isna().sum()
print(f"  prompts with no reply: {unanswered}")
empty_snap = snapshots["plain_text"].isna().sum()
print(f"  snapshots with empty text: {empty_snap} (expected: one per memo at first load)")
last_words = snapshots.sort_values("captured_at").groupby(key)["word_count"].last()
print("  final word count per memo:")
print(last_words.to_string())
if (summary["final_word_count"].fillna(0) == 0).any() and (summary["state"] != "writing").any():
    note("some submitted memos have a final word count of 0")

layout_cols = [c for c in ["split_layout_ms", "editor_max_ms", "chat_max_ms", "layout_changes",
                           "chat_scroll_px", "chat_scroll_up_px", "chat_selections"] if c in summary.columns]
if layout_cols:
    ok(f"new layout / reading columns present: {layout_cols}")
else:
    problem("layout / reading columns missing from the summary (views not updated on the server?)")

# --------------------------------------------------------------- first look
print("\n=== 8. First look: AI vs NoAI on memo 1 ===")
metrics = ["open_seconds", "tab_visible_ms", "input_active_ms", "editor_focus_ms", "chat_focus_ms",
           "editor_keystrokes", "editor_backspaces", "prompts_sent", "ai_chars_into_editor",
           "external_pastes", "final_word_count", "away_episodes"]
metrics = [m for m in metrics if m in summary.columns]
table = summary.groupby("study_condition")[metrics].mean().T
table.columns = [f"mean ({c})" for c in table.columns]
print(table.round(1).to_string())

try:
    from scipy import stats  # noqa: WPS433

    print("\n  Welch t-test per metric (tiny test sample, illustrative only):")
    for m in metrics:
        a = summary.loc[summary["study_condition"] == "AI", m].astype(float)
        b = summary.loc[summary["study_condition"] == "NoAI", m].astype(float)
        if a.nunique() > 1 or b.nunique() > 1:
            t, p = stats.ttest_ind(a, b, equal_var=False)
            print(f"    {m:24s} t={t:6.2f}  p={p:.3f}")
except ImportError:
    note("scipy not installed; skipped t-tests (pip install scipy)")

# --------------------------------------------------------------- verdict
print("\n=== Verdict ===")
if problems:
    print(f"  {len(problems)} problem(s):")
    for p in problems:
        print(f"    - {p}")
else:
    print("  No problems found. The export is consistent and ready for analysis.")
if notes:
    print("  Notes:")
    for n in notes:
        print(f"    - {n}")

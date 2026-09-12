"""
Build the one table every analysis runs from: one row per student per memo.

    python scripts/build-memo-table.py analysis/2026-09-12T22-14-48

Writes  <export folder>/memo_level.csv  with:
  - identity: participant_id, memo_number, group (A-D), condition (AI / NoAI)
  - a row for EVERY scheduled student-memo pair, so absences are visible
    (missing = the student never opened that memo)
  - engagement measures from participant_week_summary.csv
  - due date and whether the submission was late
  - outcome scores, if the optional files below are present in the folder:
      grades.csv     columns: participant_id, memo_number, facts, rules, reasoning
      qualtrics.csv  columns: participant_id, memo_number, then any survey /
                     quiz score columns (kept as-is)

Then prints paired AI-vs-NoAI comparisons per student for a few measures, so
the analysis shape is visible even before the outcome files exist.
"""
import json
import sys
from pathlib import Path

import pandas as pd

folder = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
project = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- schedule
# Every scheduled student-memo pair, with group and condition, from the
# mapping the server itself uses. Test ids (20001-20020) are dropped.
mapping = pd.read_csv(project / "server" / "data" / "participant-conditions.csv", dtype=str)
mapping = mapping[~mapping["participantID"].astype(int).between(20001, 20020)]

# Group is not stored anywhere in the app; it is defined by the memo-1..6
# sequence. These are the four sequences in the study design spreadsheet.
GROUP_BY_SEQUENCE = {
    ("AI", "AI", "NoAI", "AI", "NoAI", "NoAI"): "A",
    ("NoAI", "NoAI", "AI", "NoAI", "AI", "AI"): "B",
    ("AI", "NoAI", "AI", "AI", "NoAI", "NoAI"): "C",
    ("NoAI", "AI", "NoAI", "NoAI", "AI", "AI"): "D",
}
memo_cols = [c for c in mapping.columns if c.startswith("memo")]
rows = []
for _, r in mapping.iterrows():
    seq = tuple(r[c] for c in memo_cols)
    group = GROUP_BY_SEQUENCE.get(seq, "?")
    for i, c in enumerate(memo_cols, start=1):
        rows.append({"participant_id": r["participantID"], "memo_number": i,
                     "group": group, "condition": r[c]})
schedule = pd.DataFrame(rows)

# ---------------------------------------------------------------- due dates
due = json.loads((project / "server" / "data" / "memo-due-dates.json").read_text())
schedule["due_date_text"] = schedule["memo_number"].astype(str).map(due)
# "Sat, Sep 19, 2026, 11:59 PM PT" -> a real timestamp in Pacific time
schedule["due_at"] = pd.to_datetime(
    schedule["due_date_text"].str.replace(" PT", "", regex=False),
    format="%a, %b %d, %Y, %I:%M %p", errors="coerce"
).dt.tz_localize("America/Los_Angeles")

# ---------------------------------------------------------------- engagement
summary = pd.read_csv(folder / "participant_week_summary.csv",
                      dtype={"participant_id": str})
summary = summary.drop(columns=["assignment_id", "system_ids", "study_condition"], errors="ignore")
summary["memo_number"] = summary["memo_number"].astype(int)
summary["submitted_at"] = pd.to_datetime(summary["submitted_at"], utc=True, errors="coerce", format="ISO8601")

table = schedule.merge(summary, on=["participant_id", "memo_number"], how="left")
table["opened"] = table["session_count"].notna()
table["late"] = (table["submitted_at"] > table["due_at"]).where(table["submitted_at"].notna())

# Convenience: milliseconds -> minutes for the time columns.
for col in list(table.columns):
    if col.endswith("_ms"):
        table[col.replace("_ms", "_min")] = (table[col] / 60000).round(2)

# ---------------------------------------------------------------- outcomes
for name in ["grades.csv", "qualtrics.csv"]:
    path = folder / name
    if path.exists():
        extra = pd.read_csv(path, dtype={"participant_id": str})
        extra["memo_number"] = extra["memo_number"].astype(int)
        table = table.merge(extra, on=["participant_id", "memo_number"], how="left")
        print(f"merged {name}: {len(extra.columns) - 2} score columns")
    else:
        print(f"(no {name} in the folder yet; add it with columns participant_id, memo_number, ...)")

out = folder / "memo_level.csv"
table.to_csv(out, index=False)
print(f"\nwrote {out}: {len(table)} rows (one per scheduled student-memo), {len(table.columns)} columns")
print(f"  opened so far: {int(table['opened'].sum())} of {len(table)}")

# ---------------------------------------------------------------- paired look
print("\nPaired AI vs NoAI per student (mean over their memos in each condition):")
measures = [m for m in ["tab_visible_min", "input_active_min", "editor_focus_min",
                        "editor_keystrokes", "final_word_count", "external_pastes",
                        "facts", "rules", "reasoning"] if m in table.columns]
opened = table[table["opened"]]
paired = opened.pivot_table(index="participant_id", columns="condition", values=measures, aggfunc="mean")
both = paired.dropna(how="any")
if len(both) < 2:
    print("  (fewer than two students have memos in both conditions yet; nothing to pair)")
else:
    try:
        from scipy import stats
    except ImportError:
        stats = None
    for m in measures:
        a, b = both[(m, "AI")], both[(m, "NoAI")]
        line = f"  {m:20s} n={len(both):2d}  AI mean={a.mean():8.1f}  NoAI mean={b.mean():8.1f}"
        if stats is not None and (a - b).nunique() > 1:
            t, p = stats.ttest_rel(a, b)
            line += f"  paired t={t:5.2f} p={p:.3f}"
        print(line)

"use client";

import { useState } from "react";
import { saveMonthlyGoal } from "../app/settings/actions";
import { Target, Save } from "lucide-react";

// Editable monthly fundraising goal (NEW-14). The dashboard gauge measures
// "raised this month" against this number. Stored in org_profile so it persists
// and is editable here, mirroring the Brain/signature editor pattern.
export default function MonthlyGoalEditor({ goal }: { goal: number }) {
  const [value, setValue] = useState(String(goal));
  const [saved, setSaved] = useState(false);

  return (
    <div className="card">
      <div className="card-h"><span className="flex"><Target size={15} /> Monthly fundraising goal</span></div>
      <div className="card-pad" style={{ paddingTop: 14 }}>
        <div className="faint" style={{ fontSize: 11.5, marginBottom: 12 }}>
          The target the dashboard gauge measures this month&apos;s donations against.
        </div>
        <form
          action={async (fd: FormData) => {
            await saveMonthlyGoal(fd);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
          }}
          className="flex"
          style={{ gap: 8, alignItems: "flex-end" }}
        >
          <div style={{ flex: 1 }}>
            <label htmlFor="goal-input">Goal (USD)</label>
            <div className="flex" style={{ gap: 8, marginTop: 6 }}>
              <span className="strong" style={{ fontSize: 18, color: "var(--muted)" }}>$</span>
              <input
                id="goal-input"
                name="goal"
                inputMode="numeric"
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="5000"
              />
            </div>
          </div>
          <button className="btn teal" type="submit"><Save size={13} /> {saved ? "Saved" : "Save"}</button>
        </form>
      </div>
    </div>
  );
}

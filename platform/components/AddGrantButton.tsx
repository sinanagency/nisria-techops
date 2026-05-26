"use client";

import { useState } from "react";
import Modal from "./Modal";
import { addGrant } from "../app/grants/actions";
import { FilePlus2 } from "lucide-react";

// "Add a grant" moved out of the column bottom into a header button → Modal
// (FEEDBACK #18). Same server action and fields as before, just a proper home.
export default function AddGrantButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>
        <FilePlus2 size={15} /> Add grant
      </button>

      <Modal open={open} onClose={() => setOpen(false)} width={480} title="Add a grant">
        <form
          action={addGrant}
          onSubmit={() => setTimeout(() => setOpen(false), 50)}
          className="stack"
          style={{ gap: 13 }}
        >
          <div>
            <label>Funder</label>
            <input name="funder" placeholder="e.g. Segal Family Foundation" required style={{ marginTop: 5 }} />
          </div>
          <div>
            <label>Program / fund name</label>
            <input name="program" placeholder="Program or fund (optional)" style={{ marginTop: 5 }} />
          </div>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div>
              <label>Amount (USD)</label>
              <input name="amount_requested" type="number" min="0" step="100" placeholder="0" style={{ marginTop: 5 }} />
            </div>
            <div>
              <label>Deadline</label>
              <input name="deadline" type="date" style={{ marginTop: 5 }} />
            </div>
          </div>
          <div className="flex" style={{ gap: 10, justifyContent: "flex-end", marginTop: 2 }}>
            <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn teal sm"><FilePlus2 size={14} /> Add grant</button>
          </div>
          <div className="faint" style={{ fontSize: 11 }}>
            It lands in Researching. The Grant agent prepares the full package automatically, or tap “Prepare all ready”.
          </div>
        </form>
      </Modal>
    </>
  );
}

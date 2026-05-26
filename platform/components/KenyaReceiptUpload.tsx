"use client";

import { useState } from "react";
import Modal from "./Modal";
import { logKenyaReceipt } from "../app/finance/actions";
import { MapPin, UploadCloud, Plus } from "lucide-react";

// Upload PAST Kenya receipts + log the KES spend so the "Paid out in Kenya"
// side of the reconciliation reflects real ground spend (today it reads KES 0).
// Copy is explicit that historical data may be incomplete, and that everything
// going forward is captured. Reuses logPayout-style server action; records only.
export default function KenyaReceiptUpload() {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <>
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>
        <UploadCloud size={14} /> Log a past Kenya receipt
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={520}
        title="Log a Kenya receipt"
        titleExtra={<span className="badge green" style={{ fontSize: 10 }}>KES · ground spend</span>}
      >
        <div className="flex" style={{ gap: 9, marginBottom: 14 }}>
          <span className="aico green" style={{ width: 34, height: 34, borderRadius: 11, flexShrink: 0 }}><MapPin size={16} /></span>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            Upload any receipt you already have from the field. We know older spend may be missing or partial — that’s
            okay. From here forward, every receipt you log here is captured, and the “Paid out in Kenya” side of the
            reconciliation will reflect real ground spend instead of zero. This only records the spend; it never moves money.
          </div>
        </div>

        <form action={logKenyaReceipt} onSubmit={() => setTimeout(() => { setOpen(false); setFileName(null); }, 50)} className="stack" style={{ gap: 13 }}>
          <label
            htmlFor="kenya-receipt"
            style={{ display: "block", padding: 18, textAlign: "center", cursor: "pointer", border: "2px dashed var(--line-2)", borderRadius: "var(--radius-sm)" }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#E7F6EC", color: "#15803D", display: "grid", placeItems: "center", margin: "0 auto 8px" }}>
              <UploadCloud size={18} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{fileName || "Attach the receipt (optional)"}</div>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>Photo or screenshot. Stored privately. You can also log spend with no image.</div>
          </label>
          <input
            id="kenya-receipt"
            type="file"
            name="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => setFileName(e.target.files?.[0]?.name || null)}
          />

          <div>
            <label>Paid to / what for</label>
            <input name="payee" placeholder="e.g. Field team transport, school fees, supplies" style={{ marginTop: 5 }} />
          </div>

          <div className="grid cols-2" style={{ gap: 12 }}>
            <div>
              <label>Amount</label>
              <input name="amount" type="number" min="0" step="0.01" placeholder="0" required style={{ marginTop: 5 }} />
            </div>
            <div>
              <label>Currency</label>
              <select name="currency" defaultValue="KES" style={{ marginTop: 5 }}>
                <option value="KES">KES</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          <div className="grid cols-2" style={{ gap: 12 }}>
            <div>
              <label>Date paid (optional)</label>
              <input name="paid_at" type="date" style={{ marginTop: 5 }} />
            </div>
            <div>
              <label>Note (optional)</label>
              <input name="purpose" placeholder="Any detail you remember" style={{ marginTop: 5 }} />
            </div>
          </div>

          <div className="flex" style={{ gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn teal sm"><Plus size={14} /> Log Kenya spend</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

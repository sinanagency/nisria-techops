"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTabs } from "./tabs-context";
import PreviewLink from "./PreviewLink";
import { Money } from "./Money";
import { issueInvoice, draftInvoiceFromText } from "../app/reports/actions";
import type { InvoiceResult } from "../lib/invoice";
import {
  ReceiptText, Plus, Trash2, Loader2, Sparkles, Printer, Download, AlertTriangle, Paperclip, Wand2,
} from "lucide-react";

// Read an image File to the {media,data} shape the vision call expects.
function fileToImage(f: File): Promise<{ media: string; data: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ media: f.type, data: String(r.result).split(",")[1] || "" });
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

// The invoice builder (R3-5 / P11, img 170). Issues an invoice TO another
// company: bill-to fields, line items (description / qty / unit price / amount),
// auto subtotal/tax/total, optional notes + terms, a chosen brand letterhead.
// The "from" side, the invoice number, and the issue date are filled by the
// server (org from the brain, auto-sequence, now()). On screen the totals render
// through the shared <Money> primitive; the saved invoice is branded printable
// HTML that opens in the FocusTab and exports to a real PDF via /api/studio/pdf.

const BRANDS = [
  { v: "nisria", l: "Nisria" },
  { v: "maisha", l: "Maisha" },
  { v: "ahadi", l: "AHADI" },
];

type Line = { description: string; qty: string; unitPrice: string };

const blankLine = (): Line => ({ description: "", qty: "1", unitPrice: "" });

export default function InvoiceBuilder() {
  const [brand, setBrand] = useState("nisria");
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [due, setDue] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [taxRate, setTaxRate] = useState("0");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("Payment due within 30 days of the issue date.");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // AI intake (img 214): describe it / attach a quote, AI fills the form below.
  const [aiText, setAiText] = useState("");
  const [aiFiles, setAiFiles] = useState<File[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);

  async function draftAI() {
    if (aiBusy) return;
    if (!aiText.trim() && !aiFiles.length) { setAiErr("Describe the invoice or attach a file."); return; }
    setAiBusy(true); setAiErr(null);
    try {
      const images: { media: string; data: string }[] = [];
      for (const f of aiFiles.slice(0, 4)) if (f.type.startsWith("image/")) images.push(await fileToImage(f));
      const res = await draftInvoiceFromText({ text: aiText.trim(), images });
      if (!res.ok || !res.draft) { setAiErr(res.error || "Could not read that into an invoice."); return; }
      const d = res.draft;
      if (d.billToCompany) setCompany(d.billToCompany);
      if (d.billToContact) setContact(d.billToContact);
      if (d.billToEmail) setEmail(d.billToEmail);
      if (d.billToAddress) setAddress(d.billToAddress);
      if (d.currency) setCurrency(d.currency);
      if (typeof d.taxRate === "number") setTaxRate(String(d.taxRate));
      if (d.notes) setNotes(d.notes);
      if (d.terms) setTerms(d.terms);
      if (d.items?.length) setLines(d.items.map((i) => ({ description: i.description, qty: String(i.qty || 1), unitPrice: i.unitPrice ? String(i.unitPrice) : "" })));
      setAiFiles([]);
    } catch (e: any) {
      setAiErr(e?.message || "Something went wrong.");
    } finally {
      setAiBusy(false);
    }
  }
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const router = useRouter();
  const { openSheet, closeSheet } = useTabs();

  const num = (s: string) => (isFinite(Number(s)) ? Number(s) : 0);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + num(l.qty) * num(l.unitPrice), 0);
    const rate = Math.max(0, num(taxRate));
    const tax = subtotal * (rate / 100);
    return { subtotal: Math.round(subtotal * 100) / 100, tax: Math.round(tax * 100) / 100, total: Math.round((subtotal + tax) * 100) / 100 };
  }, [lines, taxRate]);

  function setLine(i: number, key: keyof Line, val: string) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));
  }
  function addLine() { setLines((prev) => [...prev, blankLine()]); }
  function removeLine(i: number) { setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i))); }

  function printResult() {
    const win = iframeRef.current?.contentWindow;
    if (win) { win.focus(); win.print(); }
  }

  async function run() {
    if (busy) return;
    if (!company.trim()) { setError("Enter the company this invoice bills."); return; }
    const items = lines
      .map((l) => ({ description: l.description.trim(), qty: num(l.qty), unitPrice: num(l.unitPrice) }))
      .filter((l) => l.description && (l.qty > 0 || l.unitPrice > 0));
    if (!items.length) { setError("Add at least one line item with a description and amount."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await issueInvoice({
        brand,
        billToCompany: company.trim(),
        billToContact: contact.trim() || undefined,
        billToAddress: address.trim() || undefined,
        billToEmail: email.trim() || undefined,
        dueDate: due || null,
        currency,
        items,
        taxRate: Math.max(0, num(taxRate)),
        notes: notes.trim() || undefined,
        terms: terms.trim() || undefined,
      });
      if (res.ok && res.html) {
        openResult(res);
        // reset the bill-to + lines for the next invoice; keep brand/terms
        setCompany(""); setContact(""); setAddress(""); setEmail(""); setDue(""); setNotes("");
        setLines([blankLine()]);
        router.refresh();
      } else {
        setError(res.error || "Could not create the invoice.");
      }
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function openResult(res: InvoiceResult) {
    const id = `invoice-result:${res.invoiceId || Date.now()}`;
    openSheet({
      id,
      title: (res.invoiceNumber || "Invoice").slice(0, 28),
      icon: "dollar",
      titleExtra: <span className="badge teal" style={{ fontSize: 10 }}>branded · issued</span>,
      render: () => (
        <>
          <iframe
            ref={iframeRef}
            title="Invoice preview"
            sandbox="allow-same-origin allow-modals"
            srcDoc={res.html}
            style={{ width: "100%", height: "66vh", border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}
          />
          <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
            Saved to your invoices and Library as {res.invoiceNumber}. Download a PDF or print to send it.
          </div>
        </>
      ),
      footer: (
        <>
          {res.docId && <PreviewLink href={`/api/studio/pdf?id=${res.docId}`} kind="pdf" title="Invoice" className="btn teal sm"><Download size={13} /> View PDF</PreviewLink>}
          <button type="button" className="btn ghost sm" onClick={printResult}><Printer size={13} /> Print</button>
          <button type="button" className="btn ghost sm" onClick={() => closeSheet(id)}>Close</button>
        </>
      ),
    });
  }

  return (
    <div className="card" id="invoice-builder">
      <div className="card-h">
        <span className="flex"><ReceiptText size={15} /> Issue an invoice</span>
        <span className="badge gold" style={{ fontSize: 10 }}>to another company</span>
      </div>
      <div className="card-pad stack" style={{ gap: 16 }}>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          Bill another company on your letterhead. The invoice number, issue date, and the from details are filled automatically; you add the bill-to and the line items, or just describe it and let AI fill them.
        </div>

        {/* AI intake (img 214): describe it in plain English / attach a quote */}
        <div className="card" style={{ padding: 14, boxShadow: "none", background: "var(--peri-50)", border: "1px solid var(--peri-100)" }}>
          <div className="flex" style={{ gap: 8, marginBottom: 8 }}>
            <Wand2 size={15} color="var(--peri-700)" />
            <span style={{ fontWeight: 600, fontSize: 13, color: "var(--peri-700)" }}>Draft with AI</span>
          </div>
          <textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            rows={2}
            placeholder="Describe it in plain English, e.g. 'Invoice Acme Ltd for 20 school uniforms at $12 each plus a $50 delivery fee, due in 14 days.'"
            disabled={aiBusy}
          />
          <div className="flex wrap" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
            <label className="actionchip" style={{ fontSize: 11.5, cursor: aiBusy ? "default" : "pointer" }}>
              <Paperclip size={12} /> {aiFiles.length ? `${aiFiles.length} attached` : "Attach a quote/photo"}
              <input type="file" accept="image/*" multiple style={{ display: "none" }} disabled={aiBusy} onChange={(e) => { setAiFiles(Array.from(e.target.files || []).slice(0, 4)); e.target.value = ""; }} />
            </label>
            <button type="button" className="btn sm teal" onClick={draftAI} disabled={aiBusy || (!aiText.trim() && !aiFiles.length)}>
              {aiBusy ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />} {aiBusy ? "Reading…" : "Draft invoice"}
            </button>
            {aiErr && <span style={{ color: "var(--danger)", fontSize: 12 }}>{aiErr}</span>}
          </div>
          <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>AI fills the fields below. Review and edit before issuing; any price it cannot find is left at 0.</div>
        </div>

        {/* bill-to */}
        <div>
          <div className="report-subhead" style={{ marginBottom: 8 }}>Bill to</div>
          <div className="stack" style={{ gap: 8 }}>
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" disabled={busy} />
            <div className="flex" style={{ gap: 8, flexWrap: "wrap" }}>
              <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Contact person (optional)" disabled={busy} style={{ flex: 1, minWidth: 180 }} />
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Billing email (optional)" disabled={busy} style={{ flex: 1, minWidth: 180 }} />
            </div>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Billing address (optional)" disabled={busy} />
          </div>
        </div>

        {/* line items */}
        <div>
          <div className="report-subhead" style={{ marginBottom: 8 }}>Line items</div>
          <div className="stack" style={{ gap: 8 }}>
            {lines.map((l, i) => (
              <div key={i} className="flex" style={{ gap: 8, alignItems: "center" }}>
                <input value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} placeholder="Description" disabled={busy} style={{ flex: 1, minWidth: 140 }} />
                <input value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} placeholder="Qty" inputMode="decimal" disabled={busy} style={{ width: 64 }} />
                <input value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} placeholder="Unit price" inputMode="decimal" disabled={busy} style={{ width: 96 }} />
                <span className="money-amt" style={{ width: 92, textAlign: "right", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                  <Money amount={num(l.qty) * num(l.unitPrice)} currency={currency} />
                </span>
                <button type="button" className="icon-btn tip-host" data-tip="Remove line" onClick={() => removeLine(i)} disabled={busy || lines.length === 1} aria-label="Remove line">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="actionchip" onClick={addLine} disabled={busy} style={{ alignSelf: "flex-start", fontSize: 11.5 }}>
              <Plus size={12} /> Add line
            </button>
          </div>
        </div>

        {/* totals + meta */}
        <div className="flex wrap" style={{ gap: 16, alignItems: "flex-start", justifyContent: "space-between" }}>
          <div className="flex wrap" style={{ gap: 12, alignItems: "flex-end" }}>
            <label className="stack" style={{ gap: 4, fontSize: 11.5 }}>
              <span className="faint">Letterhead</span>
              <select value={brand} onChange={(e) => setBrand(e.target.value)} disabled={busy} style={{ width: "auto", minWidth: 120 }}>
                {BRANDS.map((b) => <option key={b.v} value={b.v}>{b.l}</option>)}
              </select>
            </label>
            <label className="stack" style={{ gap: 4, fontSize: 11.5 }}>
              <span className="faint">Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={busy} style={{ width: 90 }}>
                <option value="USD">USD</option>
                <option value="KES">KES</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </label>
            <label className="stack" style={{ gap: 4, fontSize: 11.5 }}>
              <span className="faint">Tax %</span>
              <input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} inputMode="decimal" disabled={busy} style={{ width: 70 }} />
            </label>
            <label className="stack" style={{ gap: 4, fontSize: 11.5 }}>
              <span className="faint">Due date</span>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} disabled={busy} />
            </label>
          </div>
          <div className="stack" style={{ gap: 4, fontSize: 13, minWidth: 180 }}>
            <div className="between"><span className="muted">Subtotal</span><Money amount={totals.subtotal} currency={currency} /></div>
            {num(taxRate) > 0 && <div className="between"><span className="muted">Tax ({num(taxRate)}%)</span><Money amount={totals.tax} currency={currency} /></div>}
            <div className="between" style={{ fontWeight: 700, fontSize: 15, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
              <span>Total</span><Money amount={totals.total} currency={currency} />
            </div>
          </div>
        </div>

        {/* notes + terms */}
        <div className="flex wrap" style={{ gap: 10 }}>
          <label className="stack" style={{ gap: 4, flex: 1, minWidth: 220, fontSize: 11.5 }}>
            <span className="faint">Notes (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={busy} />
          </label>
          <label className="stack" style={{ gap: 4, flex: 1, minWidth: 220, fontSize: 11.5 }}>
            <span className="faint">Payment terms</span>
            <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} disabled={busy} />
          </label>
        </div>

        <div className="flex" style={{ gap: 10, alignItems: "center" }}>
          <button type="button" className="btn teal" onClick={run} disabled={busy || !company.trim()}>
            {busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
            {busy ? "Issuing…" : "Create invoice"}
          </button>
          {error && (
            <span className="flex" style={{ gap: 6, color: "var(--danger)", fontSize: 12.5 }}>
              <AlertTriangle size={14} /> {error}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

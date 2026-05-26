"use client";

import { Printer } from "lucide-react";

// Print / Save-as-PDF trigger. The page CSS (@media print) hides the app chrome
// and forces a clean letter layout, so the browser's print dialog produces a
// proper PDF. True headless-Chrome PDF is the next step (noted in the report).
export default function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn ghost sm no-print" onClick={() => window.print()}>
      <Printer size={14} /> {label}
    </button>
  );
}

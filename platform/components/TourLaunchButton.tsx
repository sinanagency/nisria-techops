"use client";

import { Sparkles } from "lucide-react";

// Fires the Sasa-led tour (handled by SasaTour in the chrome).
export default function TourLaunchButton({ label = "Take the tour with Sasa" }: { label?: string }) {
  return (
    <button className="btn" onClick={() => window.dispatchEvent(new Event("start-sasa-tour"))}>
      <Sparkles size={15} /> {label}
    </button>
  );
}

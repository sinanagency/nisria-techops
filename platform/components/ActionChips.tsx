"use client";

import { Sparkles, Mail, PenLine, ClipboardList } from "lucide-react";

const CHIPS = [
  { label: "Brief me on today", icon: Sparkles, ask: "Give me a sharp brief on where things stand right now and what needs me." },
  { label: "Draft a thank-you", icon: Mail, ask: "Draft a warm thank-you to our most recent donor." },
  { label: "Ideas for a post", icon: PenLine, ask: "Give me 3 post ideas for this week that fit Nisria's voice." },
  { label: "What's at risk?", icon: ClipboardList, ask: "What is at risk this week — donations, tasks, or anything I'm missing?" },
];

// Hero chips that open Sasa pre-loaded with a prompt.
export default function ActionChips() {
  const ask = (text: string) => window.dispatchEvent(new CustomEvent("sasa-ask", { detail: text }));
  return (
    <div className="chips">
      {CHIPS.map((c) => (
        <button key={c.label} className="actionchip" onClick={() => ask(c.ask)}>
          <span className="ico"><c.icon size={15} /></span> {c.label}
        </button>
      ))}
    </div>
  );
}

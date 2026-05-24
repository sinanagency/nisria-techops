"use client";
import { Search } from "lucide-react";

export default function HeroSearch() {
  const open = () => window.dispatchEvent(new Event("open-cmdk"));
  return (
    <div className="searchpill" onClick={open} role="button" tabIndex={0}>
      <Search size={17} color="var(--muted)" />
      <input placeholder="Search or jump to…  ⌘K" readOnly style={{ cursor: "pointer" }} />
      <button className="go" type="button" aria-label="Search"><Search size={16} /></button>
    </div>
  );
}

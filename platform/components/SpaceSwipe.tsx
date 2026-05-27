"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

// Swipe between the two primary spaces: Command Center (/) and Launchpad
// (/launchpad). Two-finger horizontal swipe or Alt+Arrow. Conservative on
// purpose: only active ON those two pages, ignores any horizontally scrollable
// element under the cursor, and has a cooldown — so it never fights content
// scroll or the live app. A small dot indicator makes it discoverable + clickable.
// (The OS four-finger gesture is not capturable in a browser; two-finger is the
// web equivalent.)
const SPACES = ["/", "/launchpad"];

export default function SpaceSwipe() {
  const path = usePathname();
  const router = useRouter();
  const acc = useRef(0);
  const lock = useRef(false);

  useEffect(() => {
    const idx = SPACES.indexOf(path);
    if (idx < 0) return;
    const go = (dir: number) => {
      const ni = idx + dir;
      if (ni < 0 || ni >= SPACES.length || lock.current) return;
      lock.current = true;
      router.push(SPACES[ni]);
      setTimeout(() => { lock.current = false; }, 700);
    };
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.5) { acc.current = 0; return; }
      let el = e.target as HTMLElement | null;
      while (el && el !== document.body) {
        const ox = getComputedStyle(el).overflowX;
        if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth) return;
        el = el.parentElement;
      }
      acc.current += e.deltaX;
      if (Math.abs(acc.current) > 130) { go(acc.current > 0 ? 1 : -1); acc.current = 0; }
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("wheel", onWheel); window.removeEventListener("keydown", onKey); };
  }, [path, router]);

  if (!SPACES.includes(path)) return null;
  const idx = SPACES.indexOf(path);
  return (
    <div className="spaces-dots" title="Swipe or Alt+Arrow to switch space">
      {SPACES.map((s, i) => (
        <button key={s} type="button" className={`spaces-dot ${i === idx ? "on" : ""}`} onClick={() => router.push(s)} aria-label={i === 0 ? "Command Center" : "Launchpad"} />
      ))}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

// Privacy: blur all money figures (class "money") across the app. Persists.
export default function MoneyToggle() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const h = localStorage.getItem("nis.hideMoney") === "1";
    setHidden(h);
    document.documentElement.classList.toggle("hide-money", h);
  }, []);
  function toggle() {
    const h = !hidden;
    setHidden(h);
    localStorage.setItem("nis.hideMoney", h ? "1" : "0");
    document.documentElement.classList.toggle("hide-money", h);
  }
  return (
    <button className="iconbtn" title={hidden ? "Show amounts" : "Hide amounts (private)"} onClick={toggle}>
      {hidden ? <EyeOff size={17} /> : <Eye size={17} />}
    </button>
  );
}

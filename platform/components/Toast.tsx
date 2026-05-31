"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

// The ONE confirmation primitive (Law 6, Real-action: loading -> success ->
// confirmation). Lives at the AppFrame root so it survives the route refresh
// that removes the card an action just resolved (e.g. an approved Needs-You
// reply revalidates away — the toast persists because it lives above the route).
// Not a modal: transient, non-blocking, aria-live. Floats above the z-modal
// ladder via --z-toast.

type Tone = "success" | "error" | "info";
type Toast = { id: number; message: string; tone: Tone };

type ToastApi = {
  toast: (message: string, opts?: { tone?: Tone; duration?: number }) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

// Safe outside a provider (returns no-ops) so a component can call useToast()
// without forcing every test/storybook host to wrap it.
export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (ctx) return ctx;
  const noop = () => {};
  return { toast: noop, success: noop, error: noop };
}

const ICON: Record<Tone, any> = { success: CheckCircle2, error: AlertTriangle, info: Info };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef<Record<number, any>>({});

  const dismiss = useCallback((id: number) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
    const h = timers.current[id];
    if (h) { clearTimeout(h); delete timers.current[id]; }
  }, []);

  const toast = useCallback<ToastApi["toast"]>((message, opts) => {
    const tone = opts?.tone || "success";
    // Errors linger longer than successes so the operator can read what failed.
    const duration = opts?.duration ?? (tone === "error" ? 6000 : 3500);
    const id = ++seq.current;
    setItems((cur) => [...cur, { id, message, tone }]);
    timers.current[id] = setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const api: ToastApi = {
    toast,
    success: (m, d) => toast(m, { tone: "success", duration: d }),
    error: (m, d) => toast(m, { tone: "error", duration: d }),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-viewport" role="region" aria-label="Notifications" aria-live="polite">
        {items.map((t) => {
          const I = ICON[t.tone];
          return (
            <div key={t.id} className={`toast toast-${t.tone}`} role="status">
              <I size={17} className="toast-ico" />
              <span className="toast-msg">{t.message}</span>
              <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export default ToastProvider;

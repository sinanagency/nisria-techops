export const dynamic = "force-dynamic";

export const metadata = {
  title: "Scheduled maintenance · Nisria Command Center",
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return (
    <main
      className="min-h-screen w-full text-[--ink] flex flex-col"
      style={{
        background:
          "radial-gradient(900px 600px at 12% 10%, rgba(0,196,194,0.10), transparent 70%), radial-gradient(900px 600px at 90% 80%, rgba(91,107,240,0.08), transparent 70%), #FAFBFC",
      }}
    >
      <header className="px-8 pt-8">
        <div className="flex items-center gap-2 text-[13px] font-medium tracking-wide text-neutral-700">
          <span
            aria-hidden
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: "#00C4C2" }}
          />
          Nisria Command Center
        </div>
      </header>

      <section className="flex-1 flex items-center justify-center px-6">
        <div
          className="w-full max-w-[640px] rounded-[22px] border border-black/5 bg-white/85 backdrop-blur-md p-10 md:p-12"
          style={{ boxShadow: "0 30px 70px rgba(0,0,0,0.10), 0 2px 10px rgba(0,0,0,0.06)" }}
        >
          <div className="flex items-center gap-2 mb-5">
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] px-2.5 py-1 rounded-full"
              style={{
                background: "rgba(217,119,6,0.10)",
                color: "#9A6500",
                border: "1px solid rgba(217,119,6,0.20)",
              }}
            >
              <span
                aria-hidden
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: "#D97706" }}
              />
              Scheduled maintenance
            </span>
          </div>

          <h1 className="text-[34px] md:text-[40px] font-bold leading-[1.1] tracking-[-0.025em] text-[#0E1A1A]">
            We are tightening Sasa.
          </h1>
          <p className="mt-4 text-[16px] leading-[1.55] text-[#38504F]">
            The command center and the 727 WhatsApp bot are briefly offline while we
            ship a quality pass. Your data is untouched and the board state is preserved.
            We will be back shortly.
          </p>

          <div className="mt-8 grid gap-3">
            <Row label="Portal" value="Locked, admin token bypass only" tone="warn" />
            <Row label="WhatsApp bot" value="Replying with this notice to all team and contacts" tone="warn" />
            <Row label="Data" value="Read and write paused, nothing dropped" tone="ok" />
          </div>

          <div className="mt-8 pt-6 border-t border-black/5">
            <div className="text-[13px] text-[#5F7574]">Need something urgent?</div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <a
                href="https://wa.me/971501168462"
                className="inline-flex items-center gap-2 text-[14px] font-medium px-4 py-2 rounded-full text-white"
                style={{ background: "#0E1A1A" }}
              >
                Message Taona on WhatsApp
              </a>
              <span className="text-[13px] text-[#6A7E7D]">
                He is the only operator on the line during the window.
              </span>
            </div>
          </div>
        </div>
      </section>

      <footer className="px-8 py-6 text-[12px] text-[#6A7E7D] flex flex-wrap items-center justify-between gap-2">
        <span>Nisria Command Center, built by zanii.</span>
        <span className="tabular-nums">Window opened 2026-06-07.</span>
      </footer>
    </main>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" }) {
  const dot = tone === "ok" ? "#16A34A" : "#D97706";
  return (
    <div className="flex items-start gap-3 rounded-[14px] border border-black/5 bg-white/60 px-4 py-3">
      <span
        aria-hidden
        className="mt-[7px] inline-block w-2 h-2 rounded-full shrink-0"
        style={{ background: dot }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium uppercase tracking-[0.10em] text-[#5F7574]">
          {label}
        </div>
        <div className="mt-0.5 text-[14px] leading-snug text-[#0E1A1A]">{value}</div>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";

export default function MaintenancePage() {
  return (
    <main className="min-h-screen w-screen flex items-center justify-center bg-neutral-950 text-neutral-100 p-8">
      <div className="max-w-md text-center space-y-6">
        <div className="text-sm uppercase tracking-widest text-neutral-500">Nisria Command Center</div>
        <h1 className="text-3xl font-semibold leading-tight">Brief maintenance window</h1>
        <p className="text-neutral-400 leading-relaxed">
          We are shipping a fix to the task delegation workflow. The portal and Sasa on
          WhatsApp will be back online shortly. Nothing on the board has been touched.
        </p>
        <p className="text-neutral-500 text-sm">
          Questions, message Taona directly.
        </p>
      </div>
    </main>
  );
}

import Shell from "../../components/Shell";
import { Card, Table, Badge, Col, statusTone } from "../../components/ui";
import { admin, money, date } from "../../lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function Donors() {
  const db = admin();
  const { data } = await db.from("donors").select("*").order("lifetime_value", { ascending: false }).limit(500);
  const cols: Col<any>[] = [
    { key: "full_name", label: "Name", render: (r) => <a href={`/donors/${r.id}`} className="strong">{r.full_name}</a> },
    { key: "email", label: "Email", render: (r) => r.email || "—" },
    { key: "type", label: "Type" },
    { key: "status", label: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: "last_gift_at", label: "Last gift", render: (r) => date(r.last_gift_at) },
    { key: "lifetime_value", label: "Lifetime", align: "right", render: (r) => <span className="strong">{money(r.lifetime_value)}</span> },
  ];
  return (
    <Shell title="Donors" sub={`${data?.length || 0} records · the CRM`}>
      <Card title="All donors">
        <Table columns={cols} rows={data || []} empty="No donors yet. They'll appear here as Givebutter syncs in." />
      </Card>
    </Shell>
  );
}

// Page-level wrapper: renders the page header + content INSIDE the persistent
// AppFrame chrome (rail + tab bar + voice dock live in app/layout.tsx).
// Kept so every existing page can stay `<Shell title sub action>…</Shell>`.
export default function Shell({
  title,
  sub,
  action,
  children,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="pagehead rise">
        <div>
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {action}
      </div>
      <div className="content rise">{children}</div>
    </>
  );
}

// Page-level wrapper: renders page header + content inside the persistent
// AppFrame chrome (floating top-nav + tab bar + voice dock live in layout).
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
    <div className="pagewrap rise">
      <div className="pagehead">
        <div>
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

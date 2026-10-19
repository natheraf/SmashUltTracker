/** Panel shell shared by the admin tabs: title, hint, error line, content. */
export default function AdminSection({ title, hint = null, actions = null, error = null, children }) {
  return (
    <section className="panel admin-panel" aria-label={title}>
      <div className="panel-head">
        <h2>{title}</h2>
        {actions ? <div className="admin-row-actions">{actions}</div> : null}
      </div>
      {hint ? <p className="muted">{hint}</p> : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {children}
    </section>
  );
}

/** Shared table styles; keeps the admin panels visually consistent. */
export function AdminTable({ head, children }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={typeof cell === 'string' ? cell : String(cell.key)} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, Inbox, Loader2, X } from "lucide-react";

/* --------------------------------- buttons --------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "primary", size = "md", className = "", ...rest }: ButtonProps) {
  const sizeClass = size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "";
  return <button className={`btn btn-${variant} ${sizeClass} ${className}`} {...rest} />;
}

/* ---------------------------------- fields ---------------------------------- */

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input className={`input ${props.className ?? ""}`} {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${props.className ?? ""}`} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`select ${props.className ?? ""}`} {...props} />;
}

/* ---------------------------------- badges ---------------------------------- */

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "teal" | "violet" | "gray" | "green" | "red" | "amber" | "navy" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { tone: "teal" | "violet" | "gray"; label: string }> = {
    user: { tone: "teal", label: "Your word" },
    generated: { tone: "violet", label: "Generated draft" },
    imported: { tone: "gray", label: "Imported" }
  };
  const item = map[source] ?? { tone: "gray" as const, label: source };
  return <Badge tone={item.tone}>{item.label}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: "green" | "amber" | "gray" | "red"; label: string }> = {
    approved: { tone: "green", label: "Approved" },
    draft: { tone: "amber", label: "Draft" },
    active: { tone: "green", label: "Active" },
    archived: { tone: "gray", label: "Archived" },
    remembered: { tone: "green", label: "Remembered" },
    learning: { tone: "amber", label: "Learning" },
    needs_revision: { tone: "red", label: "Needs revision" },
    new: { tone: "gray", label: "New" }
  };
  const item = map[status] ?? { tone: "gray" as const, label: status };
  return <Badge tone={item.tone}>{item.label}</Badge>;
}

/* ---------------------------------- modal ----------------------------------- */

export function Modal({
  title,
  onClose,
  children,
  wide,
  actions
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  actions?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="card-title">
          <h2>{title}</h2>
          <Button variant="ghost" size="sm" className="btn-icon" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </Button>
        </div>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  busy
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      actions={
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <p>{body}</p>
    </Modal>
  );
}

/* ---------------------------------- misc ------------------------------------ */

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

/* Page-level wait (session boot, auth guard): fills the viewport and centers
   the spinner instead of pinning it to the top of an empty page. */
export function LoadingScreen() {
  return (
    <div className="loading-screen">
      <Spinner />
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <Inbox size={36} />}</div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="error-text" role="alert">
      {message}
    </p>
  );
}

export function HonestNote({ children }: { children: ReactNode }) {
  return (
    <div className="info-note">
      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
      <div>{children}</div>
    </div>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
      <div>
        <h1 style={{ marginBottom: subtitle ? 4 : 0 }}>{title}</h1>
        {subtitle && <p className="bilingual" style={{ margin: 0 }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}

export function SuccessLine({ children }: { children: ReactNode }) {
  return (
    <p style={{ color: "var(--success)", display: "flex", gap: 8, alignItems: "center" }}>
      <CheckCircle2 size={16} /> {children}
    </p>
  );
}

export function InlineSpinner() {
  return <Loader2 size={15} className="spin" />;
}

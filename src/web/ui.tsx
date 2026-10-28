import {
  Children, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode, type Ref, type TextareaHTMLAttributes
} from "react";
import { createPortal } from "react-dom";
import { Toaster } from "sonner";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Inbox, Loader2, X } from "lucide-react";
import { THEME_EVENT, type Theme } from "./theme.js";

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

/* ------------------------------- dropdown ---------------------------------- */

type SelectOption = { value: string; label: ReactNode };

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  /** Plain `<option value="…">label</option>` elements — parsed, not rendered. */
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  "aria-label"?: string;
};

/* Fixed-position menu geometry, measured from the trigger. */
type MenuPos = {
  left: number;
  edgeRight: number;
  top?: number;
  bottom?: number;
  minWidth: number;
  maxHeight: number;
};

const MENU_GAP = 4;
const MENU_MAX_H = 280;
const EDGE = 8;

/* A custom listbox dropdown: the native <select> renders its menu with OS
   chrome we can't style (it ignores the dark theme), so the trigger and menu
   are drawn by the app instead. The menu renders in a body portal pinned to
   the trigger's viewport position, so sticky headers, modal scrims and table
   wrappers with overflow can neither displace nor clip it. The trigger keeps
   keyboard focus (the aria-activedescendant pattern) and handles the full
   keyboard model: arrows, Home/End, Enter/Space to pick, Escape/Tab to
   dismiss. Near the viewport bottom the menu flips above the trigger; near
   the right edge it right-aligns instead of leaving the screen. */
export function Select({ value, onChange, children, className, style, disabled, "aria-label": ariaLabel }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const [flipX, setFlipX] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const options = useMemo(
    () =>
      Children.toArray(children).flatMap((child): SelectOption[] =>
        isValidElement(child) && child.type === "option"
          ? [{
              value: String((child.props as { value?: string }).value ?? ""),
              label: (child.props as { children?: ReactNode }).children
            }]
          : []
      ),
    [children]
  );
  const current = options.find((o) => o.value === value);

  // Pin the menu to the trigger's viewport rect: drop-down by default,
  // drop-up when the space below can't fit the menu and there is more room
  // above, height capped to what the chosen side actually has.
  const place = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom - EDGE;
    const spaceAbove = rect.top - EDGE;
    const up = spaceBelow < MENU_MAX_H && spaceAbove > spaceBelow;
    setMenuPos({
      left: rect.left,
      edgeRight: window.innerWidth - rect.right,
      top: up ? undefined : rect.bottom + MENU_GAP,
      bottom: up ? window.innerHeight - rect.top + MENU_GAP : undefined,
      minWidth: rect.width,
      maxHeight: Math.max(140, Math.min(MENU_MAX_H, (up ? spaceAbove : spaceBelow) - MENU_GAP))
    });
  };

  const openMenu = () => {
    if (disabled || options.length === 0) return;
    place();
    setFlipX(false);
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const close = (refocus = false) => {
    setOpen(false);
    setActive(-1);
    if (refocus) triggerRef.current?.focus();
  };

  const commit = (v: string) => {
    close(true);
    if (v !== value) onChange(v);
  };

  // Dismiss on any click outside the trigger and the portaled menu.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Re-pin the menu while anything scrolls or the window resizes.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Keep the highlighted or selected option in view once the menu opens.
  useEffect(() => {
    if (!open) return;
    const el =
      menuRef.current?.querySelector(`#${CSS.escape(id)}-opt-${active}`) ??
      menuRef.current?.querySelector('[aria-selected="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  // Once rendered, right-align the menu if it would leave the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    setFlipX(menu.getBoundingClientRect().right > window.innerWidth - EDGE);
  }, [open, menuPos]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const picked = options[active];
      if (picked) commit(picked.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      close();
    }
  };

  return (
    <div ref={rootRef} className={`dd select ${className ?? ""}`} style={style}>
      <button
        type="button"
        ref={triggerRef}
        className="dd-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="dd-value">{current?.label ?? ""}</span>
        <ChevronDown size={15} aria-hidden="true" className={`dd-caret${open ? " up" : ""}`} />
      </button>
      {open && menuPos && createPortal(
        <div
          className="dd-menu"
          role="listbox"
          aria-label={ariaLabel}
          ref={menuRef}
          style={{
            left: flipX ? undefined : menuPos.left,
            right: flipX ? menuPos.edgeRight : undefined,
            top: menuPos.top,
            bottom: menuPos.bottom,
            minWidth: menuPos.minWidth,
            maxHeight: menuPos.maxHeight
          }}
        >
          {options.map((o, i) => (
            <div
              key={o.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`dd-option${i === active ? " active" : ""}${o.value === value ? " selected" : ""}`}
              onMouseEnter={() => setActive(i)}
              // Don't pull focus off the trigger on mousedown — it drives the keyboard.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(o.value)}
            >
              <span className="dd-option-label">{o.label}</span>
              {o.value === value && <Check size={14} aria-hidden="true" />}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
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
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // While open: lock the page behind the dialog and move focus onto the
  // panel so keyboard users land inside it. On close, both are restored.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus();
    };
  }, []);

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
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

/* Sonner's <Toaster>, mounted once at the app root. Toasts are pushed with
   toast()/toast.success()/toast.error() imported from "sonner" directly — no
   context needed. The theme follows the app's manual light/dark toggle via
   the THEME_EVENT that saveTheme() broadcasts. */
export function AppToaster() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
  useEffect(() => {
    const onTheme = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener(THEME_EVENT, onTheme);
    return () => window.removeEventListener(THEME_EVENT, onTheme);
  }, []);
  return <Toaster theme={theme} position="bottom-right" richColors duration={2800} closeButton />;
}

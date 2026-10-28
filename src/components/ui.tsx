import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export function Button(props: {
  children?: ReactNode; onClick?: (e: React.MouseEvent) => void; variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'lg';
  icon?: IconName; disabled?: boolean; title?: string; type?: 'button' | 'submit'; className?: string;
}) {
  const cls = ['btn', props.variant, props.size, props.className].filter(Boolean).join(' ');
  return (
    <button type={props.type ?? 'button'} className={cls} onClick={props.onClick} disabled={props.disabled} title={props.title}>
      {props.icon && <Icon name={props.icon} size={props.size === 'sm' ? 15 : 17} />}
      {props.children}
    </button>
  );
}

export function IconButton(props: { icon: IconName; title: string; onClick?: (e: React.MouseEvent) => void; on?: boolean; solid?: boolean; disabled?: boolean; size?: number; dot?: boolean }) {
  return (
    <button
      type="button"
      className={['icon-btn', props.on && 'on', props.solid && 'solid'].filter(Boolean).join(' ')}
      data-icon={props.icon}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.on}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <Icon name={props.icon} size={props.size ?? 17} />
      {props.dot && <span className="badge-dot" />}
    </button>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Labelled slider with numeric readout. Double-click resets to default. */
export function Slider(props: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
  format?: (v: number) => string; def?: number; disabled?: boolean;
}) {
  const { label, value, min, max, step = 0.01, onChange, format, def, disabled } = props;
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider" onDoubleClick={() => def != null && !disabled && onChange(def)} title={def != null ? 'Doppelklick setzt zurück' : undefined}>
      <span className="s-label">{label}</span>
      <span className="s-val">{format ? format(value) : value.toFixed(2)}</span>
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label}
        style={{ ['--p' as string]: `${p}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="e-icon"><Icon name={icon} size={24} /></div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

/** Success mark: ring burst and a check that draws itself (motion.css). */
export function DoneMark({ small }: { small?: boolean }) {
  return <span className={`done-mark${small ? ' small' : ''}`} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>;
}

/** Progress bar. value 0..1, or null for an indeterminate sweep. */
export function Progress({ value, label }: { value: number | null; label?: string }) {
  const pct = value == null ? null : Math.max(0, Math.min(1, value));
  return (
    <div>
      <div className={`progress${pct == null ? ' indeterminate' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct == null ? undefined : Math.round(pct * 100)}>
        <i style={pct == null ? undefined : ({ ['--p' as string]: pct } as CSSProperties)} />
      </div>
      {label && <div className="progress-label"><span>{label}</span>{pct != null && <span>{Math.round(pct * 100)}%</span>}</div>}
    </div>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  // rendered at the document root: covers the whole window (sidebar and status bar too), whatever the page does
  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">{children}</div>
    </div>,
    document.body,
  );
}

export interface MenuItem { label: string; icon: IconName; onClick: () => void; divider?: boolean }

/** Right-click context menu (spec §157). */
export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setMenu(null); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    const blur = () => setMenu(null);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); window.removeEventListener('blur', blur); };
  }, [menu]);
  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 210);
    const y = Math.min(e.clientY, window.innerHeight - items.length * 34 - 20);
    setMenu({ x, y, items });
  };
  const node = menu && createPortal(
    <div className="ctx-menu" ref={ref} style={{ left: menu.x, top: menu.y }} role="menu">
      {menu.items.map((it, i) => (
        <div key={i}>
          {it.divider && <hr />}
          <button role="menuitem" onClick={() => { setMenu(null); it.onClick(); }}>
            <Icon name={it.icon} size={15} /> {it.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
  return { open, node };
}

export function fmtDb(v: number, d = 1) {
  return Number.isFinite(v) ? `${v.toFixed(d)} dB` : '−∞ dB';
}
export function fmtLufs(v: number) {
  return Number.isFinite(v) ? `${v.toFixed(1)} LUFS` : '—';
}
export function fmtDur(s: number) {
  return s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`;
}

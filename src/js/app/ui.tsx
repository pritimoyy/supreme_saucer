import React from "react";

/* ─── Icons (stroke icons, inherit currentColor) ─────────────── */

const Svg: React.FC<{ size?: number; children: React.ReactNode }> = ({ size = 14, children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const Icon = {
  Paste: () => (
    <Svg>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </Svg>
  ),
  Close: () => (
    <Svg size={12}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  ),
  Settings: () => (
    <Svg size={15}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  ),
  Video: () => (
    <Svg size={13}>
      <rect x="2" y="5" width="14" height="14" rx="2" />
      <path d="m22 8-6 4 6 4V8z" />
    </Svg>
  ),
  Music: () => (
    <Svg size={13}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </Svg>
  ),
  Scissors: () => (
    <Svg size={13}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
    </Svg>
  ),
  Download: () => (
    <Svg size={15}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </Svg>
  ),
  Check: () => (
    <Svg size={13}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  ),
  Alert: () => (
    <Svg size={13}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </Svg>
  ),
  Refresh: () => (
    <Svg size={13}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5" />
    </Svg>
  ),
  Folder: () => (
    <Svg size={12}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </Svg>
  ),
  Sparkle: () => (
    <Svg size={13}>
      <path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z" />
    </Svg>
  ),
  Chevron: () => (
    <Svg size={12}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
};

/* ─── Primitives ─────────────────────────────────────────────── */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { id: T; label: React.ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div className="seg" role="tablist">
      <span
        className="seg__thumb"
        style={{ width: `calc(${100 / options.length}% - 4px)`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={o.id === value}
          className={`seg__item${o.id === value ? " is-active" : ""}`}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Switch: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}> = ({ checked, onChange, disabled, label }) => (
  <button
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={`switch${checked ? " is-on" : ""}`}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  >
    <span className="switch__knob" />
  </button>
);

export const Spinner: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <span className="spinner" style={{ width: size, height: size }} />
);

export const ProgressBar: React.FC<{ percent: number | null }> = ({ percent }) => (
  <div className={`bar${percent === null ? " is-indeterminate" : ""}`}>
    <div className="bar__fill" style={percent === null ? undefined : { width: `${Math.max(2, percent)}%` }} />
  </div>
);

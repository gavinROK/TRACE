// Small hand-drawn icon set so the app doesn't need an icon library
// dependency for a handful of glyphs.

type IconProps = { className?: string };

const base = "stroke-current fill-none";

export function OrganizationIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} strokeWidth={1.75}>
      <rect x="4" y="3" width="16" height="18" className={base} rx="1" />
      <path d="M8 21v-4h8v4M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" className={base} />
    </svg>
  );
}

export function DepartmentIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} strokeWidth={1.75}>
      <path d="M3 7l9-4 9 4-9 4-9-4z" className={base} />
      <path d="M3 12l9 4 9-4M3 17l9 4 9-4" className={base} />
    </svg>
  );
}

export function GithubIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} strokeWidth={1.75}>
      <circle cx="12" cy="12" r="9" className={base} />
      <path d="M8 16c3-1 5-1 8 0M9 9h.01M15 9h.01" className={base} />
      <path d="M7 14c1.5 2 8.5 2 10 0" className={base} />
    </svg>
  );
}

export function ApiUsageIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} strokeWidth={1.75}>
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" className={base} />
    </svg>
  );
}

export function SecurityIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} strokeWidth={1.75}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" className={base} />
      <path d="M9.5 12l1.8 1.8L14.5 10" className={base} />
    </svg>
  );
}

export function DeviceIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} strokeWidth={1.75}>
      <rect x="3" y="4" width="18" height="12" className={base} rx="1" />
      <path d="M2 20h20M9 20l1-4h4l1 4" className={base} />
    </svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} strokeWidth={2}>
      <path d="M9 6l6 6-6 6" className={base} />
    </svg>
  );
}

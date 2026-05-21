// The house mark used across the client portal surfaces.
export function PortalLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect width="48" height="48" rx="10" fill="#E3F0FF" />
      <path
        d="M24 10L10 22H14V38H22V30H26V38H34V22H38L24 10Z"
        fill="#1565C0"
      />
    </svg>
  );
}

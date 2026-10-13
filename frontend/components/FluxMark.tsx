// Brand mark. A single accent glyph — two offset flow bars inside a rounded tile —
// plus the wordmark in the serif display face. The mark is one of the few places
// the accent is allowed to appear (design.md law 2).
export function FluxMark({
  showWordmark = true,
  className = '',
}: {
  showWordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        role="img"
        aria-label="Flux"
        className="shrink-0"
      >
        <rect width="28" height="28" rx="8" fill="var(--color-primary)" />
        <path
          d="M9 9.5h10M9 14h7.5M9 18.5h4.5"
          stroke="var(--color-on-primary)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      {showWordmark && (
        <span className="font-display text-[22px] leading-none text-ink-strong">
          Flux
        </span>
      )}
    </span>
  );
}

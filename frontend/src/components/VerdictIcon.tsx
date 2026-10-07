/** The big tick or cross on a check-in verdict, so the result never rests on colour alone. */
export function VerdictIcon({ ok, className = "h-28 w-28 lg:h-40 lg:w-40" }: { ok: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="24" cy="24" r="21" />
      {ok ? <path d="M14 25l7 7 13-15" /> : <path d="M16 16l16 16M32 16L16 32" />}
    </svg>
  );
}

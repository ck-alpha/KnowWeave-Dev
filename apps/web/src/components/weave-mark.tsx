/** A pair of interlaced reading paths, shared by the masthead and the desk. */
export function WeaveMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M9 8v21c0 7 9 11 15 5L39 19M9 19l15 15c6 6 15 2 15-5V8"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M19 8v11m10-11v11M19 29v11m10-11v11"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

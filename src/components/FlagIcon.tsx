/** A flag on a pole: an outline when nothing is flagged, solid red when it is. A resolved flag stays solid but fades. */
export function FlagIcon({ on, resolved = false }: { on: boolean; resolved?: boolean }) {
  return (
    <svg className={`flag-icon${on ? ' on' : ''}${resolved ? ' resolved' : ''}`} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M6 3v18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M6 4h12l-3 4.5 3 4.5H6z"
        fill={on ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
      />
    </svg>
  );
}

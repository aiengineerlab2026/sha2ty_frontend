/** A movable part's icon: an arrow circling a vertical axis, turning about that (y) axis, like a door on its hinge.
 * Still for people who ask for reduced motion. */
export function TurnIcon({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-block [perspective:60px] ${className}`} aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="block size-full animate-[sha2ty-turn-y_2.4s_linear_infinite] motion-reduce:animate-none">
        <path d="M12 2.5v19" strokeDasharray="2 2.5" strokeWidth={1.6} />
        <path d="M18.6 9.6A9 3.6 0 1 1 7.4 9" />
        <path d="M15.6 7.6l3 2-2.6 2.4" />
      </svg>
    </span>
  );
}

/**
 * The wax seal, flat.
 *
 * One definition used by the header, the gate and the dashboard topbar, so the
 * three cannot drift apart. `focusable="false"` alongside `aria-hidden` because
 * IE-era SVG is still focusable by tab in some engines otherwise, which puts an
 * invisible stop in the keyboard order of every screen this appears on.
 */
export function Mark({ size = 25 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="48" fill="#A6321F" />
      <circle cx="50" cy="50" r="37" fill="none" stroke="#F6EEDE" strokeWidth="1.6" strokeDasharray="2 3.6" opacity=".8" />
      <text
        x="50"
        y="53"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--sans)"
        fontWeight="900"
        fontSize="44"
        fill="#F6EEDE"
      >
        C
      </text>
    </svg>
  );
}

/**
 * The stat card that opens four of the handoff's six panes.
 *
 * The design prints a delta beside each figure - `+18.4%`, `+4`, `+27`. Those
 * are period-over-period changes, and nothing on chain records a previous
 * period: the contract keeps running totals, not a history of them. So the
 * delta is shown only when a caller can actually derive one, and the card
 * simply omits it otherwise rather than printing a number nobody measured.
 *
 * `value` is a string because most of these are GEN amounts formatted from
 * wei, and rounding them through a float on the way to the screen is how a
 * balance starts disagreeing with the ledger.
 */
export default function Stat({
  label,
  value,
  unit,
  delta,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  /** Only when it was measured. See above. */
  delta?: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="stat-card">
      <div className="stat-row">
        <span className="stat-label">{label}</span>
        {delta ? <span className={`stat-delta${tone === "down" ? " down" : ""}`}>{delta}</span> : null}
      </div>
      <div className="stat-value">
        {value}
        {unit ? <span className="stat-unit">{unit}</span> : null}
      </div>
    </div>
  );
}

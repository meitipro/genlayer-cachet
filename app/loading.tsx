/**
 * The loading state for every route.
 *
 * Reads are not instant here: a round page asks the contract twice, and the
 * network answers in seconds when it is busy. Without this the browser holds
 * the previous page while it waits, so a click appears to have done nothing
 * and gets clicked again - which costs another read from the same rate limit
 * budget that made it slow.
 *
 * Deliberately plain. A skeleton that mimicked a scorecard would be inventing
 * a shape for data nobody has read yet, on a site whose whole rule is that it
 * shows what the chain said or says it could not ask.
 */
export default function Loading() {
  return (
    <section className="section on-cream">
      <div className="shell">
        <div className="eyebrow-row">
          <div className="eyebrow">Reading the chain</div>
          <div className="eyebrow-note">one moment</div>
        </div>
        <p className="lede" role="status" aria-live="polite">
          Asking the contract
        </p>
      </div>
    </section>
  );
}

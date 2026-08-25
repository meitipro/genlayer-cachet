/**
 * The loading state for the dApp routes.
 *
 * It lives in `(site)` rather than at the root ON PURPOSE. At the root it was
 * the fallback for EVERY route, including the cinematic landing - so opening
 * the site painted this cream panel reading "Reading the chain" for as long as
 * the landing's contract read took, and only then did the dark hero and its
 * seal animation arrive. A loading state for a page is fine; a loading state
 * in front of the front door is the front door.
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

import Link from "next/link";

export default function NotFound() {
  return (
    <section className="section on-cream">
      <div className="shell">
        <div className="eyebrow-row">
          <div className="eyebrow">404</div>
          <div className="eyebrow-note">nothing on record</div>
        </div>
        <h1 className="display" style={{ maxWidth: "18ch" }}>
          No such round.
        </h1>
        <p className="lede">
          Either the id does not exist on this network, or the contract this site is pointed at
          has never held it. Rounds are numbered from zero, in the order they were published.
        </p>
        <div className="btn-row">
          <Link href="/rounds" className="btn btn-primary">
            Browse the docket
          </Link>
          <Link href="/" className="btn btn-ghost">
            Back to the front
          </Link>
        </div>
      </div>
    </section>
  );
}

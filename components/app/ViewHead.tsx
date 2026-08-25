import Link from "next/link";

/**
 * The header the handoff puts above every dApp pane.
 *
 * Title, one line of subtitle, and the primary action on the right. It sits in
 * each view rather than in the shell because the title and subtitle differ per
 * pane and the shell is rendered once around all of them.
 *
 * The action is "Publish tender" on every pane in the design. That is right
 * for a buyer and wrong for a bidder reading their own scorecard, so the label
 * and destination are overridable while the default stays the design's.
 */
export default function ViewHead({
  title,
  sub,
  actionLabel = "Publish tender",
  actionHref = "/publish",
}: {
  title: string;
  sub: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="view-head">
      <div>
        <h2 className="view-title">{title}</h2>
        <p className="view-sub">{sub}</p>
      </div>
      <Link href={actionHref} className="view-action">
        {actionLabel}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M5 12h13M12.5 6l6 6-6 6" />
        </svg>
      </Link>
    </div>
  );
}

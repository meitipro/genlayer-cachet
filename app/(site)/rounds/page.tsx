import Link from "next/link";
import type { Metadata } from "next";

import { RoundCard } from "@/components/Round";
import { NotConfigured, Unreachable } from "@/components/Shell";
import { CONFIGURED, getRounds, getStats } from "@/lib/cachet";
import { formatGen, phaseOf } from "@/lib/format";

export const revalidate = 20;

export const metadata: Metadata = {
  title: "The docket",
  description: "Every tender on record: taking bids, in reveal, awaiting a decision, and settled.",
};

const PAGE = 24;

export default async function RoundsPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Math.max(0, Number(searchParams.page ?? 0) || 0);
  const now = Date.now();
  const [pageData, stats] = await Promise.all([getRounds(page * PAGE, PAGE), getStats()]);
  const total = pageData?.total ?? 0;
  const rounds = pageData?.rounds ?? [];

  const open = rounds.filter((r) => r.status === "open");
  const settled = rounds.filter((r) => r.status !== "open");

  const groups = [
    { name: "Taking bids", items: open.filter((r) => phaseOf(r, now) === "commit") },
    { name: "In reveal", items: open.filter((r) => phaseOf(r, now) === "reveal") },
    { name: "Awaiting a decision", items: open.filter((r) => phaseOf(r, now) === "decide") },
    { name: "Settled", items: settled },
  ].filter((g) => g.items.length);

  return (
    <>
      {!CONFIGURED ? <NotConfigured /> : null}
      {CONFIGURED && !pageData ? <Unreachable what="the docket" /> : null}

      <section className="on-ink section-tight">
        <div className="shell">
          <div className="breadcrumb">The docket</div>
          <h1
            style={{
              fontWeight: 800,
              fontSize: "clamp(30px,4vw,48px)",
              lineHeight: 1.02,
              letterSpacing: "-.035em",
              margin: "0 0 16px",
              maxWidth: "20ch",
            }}
          >
            Every tender on record.
          </h1>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.55,
              color: "var(--on-ink-dim)",
              maxWidth: "58ch",
              margin: 0,
            }}
          >
            Declined rounds are here beside awarded ones. A buyer&rsquo;s history of awarding is
            itself a signal to future bidders, and hiding the rounds that ended in nothing would
            be the first thing worth hiding.
          </p>

          <div className="grid grid-auto-160" style={{ marginTop: 28, borderColor: "var(--ink-line)" }}>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Rounds</div>
              <div className="stat-value">{stats ? stats.rounds : " - "}</div>
            </div>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Awarded</div>
              <div className="stat-value">{stats ? stats.awarded : " - "}</div>
            </div>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Declined</div>
              <div className="stat-value">{stats ? stats.declined : " - "}</div>
            </div>
            <div className="stat" style={{ borderColor: "var(--ink-line)" }}>
              <div className="label">Paid out</div>
              <div className="stat-value">
                {stats ? formatGen(stats.paid) : " - "} {stats ? <small>GEN</small> : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-tight on-cream">
        <div className="shell">
          {groups.length === 0 ? (
            <div className="empty">
              {/* "There are none" and "we could not look" are different claims.
                  Asserting the first because of the second is the same mistake
                  as answering 404 to a rate limit. */}
              {!CONFIGURED ? (
                <p>
                  No contract is configured for this network, so there is nothing to list.
                </p>
              ) : !pageData ? (
                <p>
                  The docket could not be read, so this is not a claim that it is empty.
                  <br />
                  <Link href="/rounds">Try again.</Link>
                </p>
              ) : (
                <p>
                  No tender has been published yet.
                  <br />
                  <Link href="/publish">Publish the first one.</Link>
                </p>
              )}
            </div>
          ) : (
            <div className="stack" style={{ gap: 40 }}>
              {groups.map((g) => (
                <div key={g.name}>
                  <div className="eyebrow-row">
                    <div className="eyebrow">{g.name}</div>
                    <div className="eyebrow-note">
                      {g.items.length} round{g.items.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="grid grid-auto-290">
                    {g.items.map((r) => (
                      <RoundCard key={r.id} round={r} now={now} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {total > PAGE ? (
            <div className="row" style={{ marginTop: 30, justifyContent: "space-between" }}>
              {page > 0 ? (
                <Link href={`/rounds?page=${page - 1}`} className="btn btn-ghost btn-small">
                  ← Newer
                </Link>
              ) : (
                <span />
              )}
              <span className="label">
                {page * PAGE + 1} - {Math.min((page + 1) * PAGE, total)} of {total}
              </span>
              {(page + 1) * PAGE < total ? (
                <Link href={`/rounds?page=${page + 1}`} className="btn btn-ghost btn-small">
                  Older →
                </Link>
              ) : (
                <span />
              )}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

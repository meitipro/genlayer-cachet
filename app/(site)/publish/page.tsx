import type { Metadata } from "next";

import PublishForm from "@/components/PublishForm";
import { NotConfigured } from "@/components/Shell";
import { CONFIGURED, getTerms } from "@/lib/cachet";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Publish a tender",
  description:
    "Write criteria that can be scored, set the weights and the tie break, escrow the budget. Once published, neither the criteria nor the weights can change.",
};

const WORKS = [
  ["relevant delivered work with references", "a proposal either names them or does not"],
  ["plan is specific and sequenced", "dates and order are visible in the text"],
  ["maintenance after handover", "a named period and price, or nothing"],
  ["price against scope", "two numbers, compared"],
];

const REFUSED = [
  ["cultural fit", "no standard exists in the text"],
  ["enthusiasm", "rewards writing style"],
  ["long term partner", "unmeasurable from a proposal"],
];

export default async function PublishPage() {
  const terms = await getTerms();

  return (
    <>
      {!CONFIGURED ? <NotConfigured /> : null}

      <section className="on-ink section-tight">
        <div className="shell">
          <div className="breadcrumb">Publish</div>
          <h1
            style={{
              fontWeight: 800,
              fontSize: "clamp(30px,4vw,48px)",
              lineHeight: 1.02,
              letterSpacing: "-.035em",
              margin: "0 0 16px",
              maxWidth: "18ch",
            }}
          >
            Write a tender that can be scored.
          </h1>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.55,
              color: "var(--on-ink-dim)",
              maxWidth: "60ch",
              margin: 0,
            }}
          >
            Separating what the buyer decides from what the network decides is the whole
            legitimacy argument, so it gets stated on the screen where the buyer sets both. You
            choose the criteria, the weights and the tie break. The network chooses the scores.
          </p>
        </div>
      </section>

      <section className="section-tight on-cream">
        <div className="shell">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
              gap: 24,
              alignItems: "start",
            }}
          >
            <PublishForm terms={terms} />

            <div className="stack">
              <div className="panel">
                <div className="panel-head">
                  <span className="label">Criteria that work</span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th
                        className="label"
                        style={{ textAlign: "left", padding: "10px 22px", borderBottom: "1px solid var(--line-softer)" }}
                      >
                        Criterion
                      </th>
                      <th
                        className="label"
                        style={{ textAlign: "left", padding: "10px 22px", borderBottom: "1px solid var(--line-softer)" }}
                      >
                        Why it works
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {WORKS.map(([c, why]) => (
                      <tr key={c}>
                        <td
                          style={{
                            padding: "12px 22px",
                            borderBottom: "1px solid var(--line-softer)",
                            fontSize: 14,
                            fontWeight: 600,
                            lineHeight: 1.4,
                          }}
                        >
                          {c}
                        </td>
                        <td
                          style={{
                            padding: "12px 22px",
                            borderBottom: "1px solid var(--line-softer)",
                            fontSize: 13.5,
                            color: "var(--muted)",
                            lineHeight: 1.45,
                          }}
                        >
                          {why}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <span className="label">Criteria the network refuses</span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {REFUSED.map(([c, why]) => (
                      <tr key={c}>
                        <td
                          style={{
                            padding: "12px 22px",
                            borderBottom: "1px solid var(--line-softer)",
                            fontSize: 14,
                            fontWeight: 600,
                            lineHeight: 1.4,
                          }}
                        >
                          {c}
                        </td>
                        <td
                          style={{
                            padding: "12px 22px",
                            borderBottom: "1px solid var(--line-softer)",
                            fontSize: 13.5,
                            color: "var(--muted)",
                            lineHeight: 1.45,
                          }}
                        >
                          {why}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="panel-body" style={{ borderTop: "1px solid var(--line-softer)" }}>
                  <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--muted)", margin: 0 }}>
                    These are refused because answering them needs a standard that is not written
                    down, outside knowledge about the bidder, or a prediction about the future -
                    not because they are bad things for a buyer to want. Put them in a
                    conversation, not in a scored tender.
                  </p>
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <span className="label">The honest limit</span>
                </div>
                <div className="panel-body">
                  <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>
                    Scoring prose is not the same as evaluating capability. A well written
                    proposal from a weak supplier will beat a badly written one from a strong
                    supplier. Criteria that ask for <strong>verifiable references</strong> blunt
                    that as far as anything can - which is why the first row of the table above is
                    the first row.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

import AppShell from "@/components/cine/AppShell";
import { Footer } from "@/components/Shell";
import { getRounds } from "@/lib/cachet";
import { NETWORK_LABEL } from "@/lib/chain";

export const revalidate = 30;

/**
 * The dashboard shell from the handoff, wrapping every page that is not the
 * landing.
 *
 * The design draws six views switched by client state behind a single URL.
 * They are real routes here instead, so the rail is navigation rather than a
 * tab strip: back works, a shared link opens the screen it names, and every
 * page keeps the server-rendered content it already had. On a product whose
 * whole claim is an auditable record, a record you cannot link to would be an
 * odd thing to ship.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Read once here rather than in the rail: the shell renders on every page,
  // and this is already cached, so the badge costs nothing extra per view.
  const page = await getRounds(0, 24);
  const counts = {
    rounds: page ? page.total : null,
    open: page ? page.rounds.filter((r) => r.status === "open").length : null,
  };

  return (
    <AppShell network={NETWORK_LABEL} counts={counts}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <main id="main">{children}</main>
      {/* The rail replaced the old site header, but not the footer: the
          contract address and the honest-limits links were only ever there,
          and dropping the chrome should not drop the record with it. */}
      <Footer />
    </AppShell>
  );
}

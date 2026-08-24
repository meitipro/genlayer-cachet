/**
 * The landing has no chrome of its own: the handoff draws its header inside
 * the fixed viewport, and a second one from the app shell above it would be
 * two headers stacked.
 *
 * `.cine` on the root element is what turns on the overflow lock in
 * cinematic.css. It is set and unset by the page rather than here, so leaving
 * the landing cannot strand the rest of the site at one viewport height.
 */
export default function CineLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

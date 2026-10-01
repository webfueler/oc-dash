/**
 * The project's one money formatter. The dashboard, the panel and
 * /api/summary all call it, so a cost reads identically in every surface.
 *
 * It lives under `server/` rather than `src/` because the API sends the
 * finished string and tsconfig.server.json pins `rootDir: "server"`: a server
 * module importing `src/format.ts` fails the build with TS6059. `src/format.ts`
 * re-exports this function rather than keeping its own copy, so there is still
 * exactly one implementation and `fmtMoney === fmtUSD` still holds.
 *
 * The rule, picked by hand in the panel's design review and now shared:
 * exactly two decimals; a genuine zero prints `$0.00`; a non-zero amount
 * under one cent prints `<$0.01` (`<-$0.01` for a credit) rather than
 * rounding to `$0.00`, which would read as free.
 *
 * The zero case is why the menu bar needed the Captain's ruling rather than a
 * default. `cost` alone cannot tell a free range from an unpriced one: both are
 * zero, and this prints `$0.00` for both. See `summary.ts`'s note on
 * `costText` for what that means on a surface with no footnote.
 */
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function fmtUSD(n: number): string {
  if (!Number.isFinite(n)) return "—"
  // `n === 0` rather than `abs < 0.01`, so a genuine zero and a negative
  // zero both land on "$0.00".
  if (n === 0) return "$0.00"
  const abs = Math.abs(n)
  if (abs < 0.01) return n < 0 ? "<-$0.01" : "<$0.01"
  return USD.format(n)
}

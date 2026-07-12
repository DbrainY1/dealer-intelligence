// DealerIQ VIN Gold — the single accent color for VIN text across DealerIQ.
// (The darker burnt-orange used in the VIN modal borders is intentionally
// separate and is not changed here.)
export const VIN_GOLD = "#FFAE00";

// Tables/lists show the last 8 characters of a VIN with a leading ellipsis.
// The full VIN remains available via tooltip / the VIN modal / the detail page.
export function shortVin(vin: string): string {
  return `…${vin.slice(-8)}`;
}

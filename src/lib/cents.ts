import Decimal from 'decimal.js';

/** Whole cents, rounded half away from zero (pure: no stores, safe on the server). */
export function roundCents(cents: number | string): number {
  if (typeof cents === 'number' && Number.isNaN(cents)) return 0;
  return new Decimal(cents || 0).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Safely converts monetary values with exchange rates or tax factors to exact integer cents.
 */
export function calculateFXCents(amountCents: number, exchangeRate: number): number {
  if (!exchangeRate || exchangeRate <= 0) return roundCents(amountCents);
  return new Decimal(amountCents).mul(exchangeRate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

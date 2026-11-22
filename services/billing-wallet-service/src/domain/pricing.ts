export interface PricingInput {
  estimatedKwh: number;
  powerKw: number;
  priorityBoost: boolean;
  at: Date;
}

export interface PriceQuote {
  estimatedKwh: number;
  baseRatePerKwh: number;
  surgeMultiplier: number;
  boostMultiplier: number;
  total: number;
  currency: string;
  strategy: string;
}

/** Strategy: cada política de precios es intercambiable sin modificar el caso de uso (OCP/LSP). */
export interface PricingStrategy {
  readonly name: string;
  quote(input: PricingInput): PriceQuote;
}

export const CURRENCY = 'COP';
export const BOOST_MULTIPLIER = 1.2;
export const SURGE_MULTIPLIER = 1.35;

/** Tarifa por kWh según potencia del conector (AC, DC rápido, ultra-rápido). */
export function baseRateFor(powerKw: number): number {
  if (powerKw >= 150) return 1800;
  if (powerKw >= 50) return 1450;
  return 1100;
}

export class StandardPricing implements PricingStrategy {
  readonly name: string = 'STANDARD';

  quote(input: PricingInput): PriceQuote {
    return this.build(input, 1);
  }

  protected build(input: PricingInput, surgeMultiplier: number): PriceQuote {
    const baseRatePerKwh = baseRateFor(input.powerKw);
    const boostMultiplier = input.priorityBoost ? BOOST_MULTIPLIER : 1;
    const total = Math.round(input.estimatedKwh * baseRatePerKwh * surgeMultiplier * boostMultiplier);
    return { estimatedKwh: input.estimatedKwh, baseRatePerKwh, surgeMultiplier, boostMultiplier, total, currency: CURRENCY, strategy: this.name };
  }
}

/** Tarifa dinámica: recargo en horas pico. Fuera de pico se comporta como la estándar. */
export class SurgePricing extends StandardPricing {
  override readonly name = 'DYNAMIC_SURGE';

  constructor(private readonly isPeak: (at: Date) => boolean) { super(); }

  override quote(input: PricingInput): PriceQuote {
    return this.build(input, this.isPeak(input.at) ? SURGE_MULTIPLIER : 1);
  }
}

/** Parsea rangos "7-9,17-21" (horas locales, fin exclusivo) en un predicado. */
export function peakHoursPredicate(spec: string, timeZone: string): (at: Date) => boolean {
  const ranges = spec.split(',').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [from, to] = r.split('-').map(Number);
    return { from: from ?? 0, to: to ?? 24 };
  });
  return (at: Date) => {
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(at));
    return ranges.some(({ from, to }) => hour >= from && hour < to);
  };
}

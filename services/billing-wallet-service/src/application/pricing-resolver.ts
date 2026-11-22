import type { FeatureFlagReader } from '@aegisvolt/shared';
import { StandardPricing, SurgePricing, type PricingStrategy } from '../domain/pricing.js';

/** Selecciona la estrategia de precios según la flag ENABLE_DYNAMIC_SURGE_PRICING del ambiente. */
export class PricingStrategyResolver {
  private readonly standard = new StandardPricing();
  private readonly surge: SurgePricing;

  constructor(private readonly flags: FeatureFlagReader, isPeak: (at: Date) => boolean) {
    this.surge = new SurgePricing(isPeak);
  }

  async resolve(): Promise<PricingStrategy> {
    return (await this.flags.isEnabled('ENABLE_DYNAMIC_SURGE_PRICING')) ? this.surge : this.standard;
  }
}

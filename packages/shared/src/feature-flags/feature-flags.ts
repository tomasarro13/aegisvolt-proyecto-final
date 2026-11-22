/** Flags exigidas por la especificación. Cada ambiente tiene su propio estado en su propia tabla. */
export const FLAG_KEYS = [
  'ENABLE_DYNAMIC_SURGE_PRICING',
  'ENABLE_FAST_CHARGE_BOOST',
  'SIMULATE_CHARGER_HARDWARE_FAULT',
] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];

export const isFlagKey = (value: string): value is FlagKey => (FLAG_KEYS as readonly string[]).includes(value);

export interface FeatureFlag {
  key: FlagKey;
  enabled: boolean;
  description: string;
  environment: string;
  updatedAt: string;
  updatedBy?: string;
}

/** Puerto de lectura (ISP: los servicios de negocio solo necesitan consultar). */
export interface FeatureFlagReader {
  isEnabled(key: FlagKey): Promise<boolean>;
}

/** Puerto de administración, usado solo por la capa GraphQL / panel de operaciones. */
export interface FeatureFlagAdmin extends FeatureFlagReader {
  list(): Promise<FeatureFlag[]>;
  set(key: FlagKey, enabled: boolean, updatedBy: string): Promise<FeatureFlag>;
}

/** Implementación en memoria para pruebas unitarias. */
export class InMemoryFeatureFlags implements FeatureFlagAdmin {
  private readonly flags = new Map<FlagKey, FeatureFlag>();

  constructor(initial: Partial<Record<FlagKey, boolean>> = {}, private readonly environment = 'test') {
    for (const key of FLAG_KEYS) this.flags.set(key, this.build(key, initial[key] ?? false));
  }

  async isEnabled(key: FlagKey): Promise<boolean> { return this.flags.get(key)?.enabled ?? false; }
  async list(): Promise<FeatureFlag[]> { return [...this.flags.values()]; }
  async set(key: FlagKey, enabled: boolean, updatedBy: string): Promise<FeatureFlag> {
    const flag = { ...this.build(key, enabled), updatedBy };
    this.flags.set(key, flag);
    return flag;
  }

  private build(key: FlagKey, enabled: boolean): FeatureFlag {
    return { key, enabled, description: key, environment: this.environment, updatedAt: new Date().toISOString() };
  }
}

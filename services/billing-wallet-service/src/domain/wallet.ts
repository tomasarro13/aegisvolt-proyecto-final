import { InsufficientFundsError } from './errors.js';

export interface WalletSnapshot {
  fleetId: string;
  fleetName: string;
  balance: number;
  currency: string;
  version: number;
  updatedAt: string;
}

/** Billetera prepagada de la flota. Invariante: el saldo nunca es negativo. */
export class Wallet {
  private constructor(private state: WalletSnapshot) {}

  static fromSnapshot(s: WalletSnapshot): Wallet { return new Wallet({ ...s }); }

  get fleetId(): string { return this.state.fleetId; }
  get balance(): number { return this.state.balance; }
  get version(): number { return this.state.version; }
  get currency(): string { return this.state.currency; }

  canAfford(amount: number): boolean { return this.state.balance >= amount; }

  debit(amount: number, now: Date): void {
    if (amount <= 0) throw new RangeError('El monto a debitar debe ser positivo');
    if (!this.canAfford(amount)) throw new InsufficientFundsError(this.state.fleetId, amount, this.state.balance);
    this.apply(this.state.balance - amount, now);
  }

  credit(amount: number, now: Date): void {
    if (amount <= 0) throw new RangeError('El monto a acreditar debe ser positivo');
    this.apply(this.state.balance + amount, now);
  }

  toSnapshot(): WalletSnapshot { return { ...this.state }; }

  private apply(balance: number, now: Date): void {
    this.state = { ...this.state, balance: Math.round(balance * 100) / 100, version: this.state.version + 1, updatedAt: now.toISOString() };
  }
}

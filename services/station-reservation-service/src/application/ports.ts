/** Abstracción del reloj para que los casos de uso sean deterministas en pruebas. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

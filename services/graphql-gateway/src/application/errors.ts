import { AppError } from '@aegisvolt/shared';

export class ForbiddenFlagChange extends AppError {
  constructor() {
    super('FLAG_MUTATION_FORBIDDEN', 'Cambiar feature flags desde la API está deshabilitado en este ambiente (use el proceso de cambio controlado)', 403);
  }
}

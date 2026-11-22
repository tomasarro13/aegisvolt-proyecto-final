import type { EnvironmentName } from '@/domain/models';

const ENVS: EnvironmentName[] = ['dev', 'test', 'prod'];

/** Configuración de servidor: URL GraphQL (API Gateway) por ambiente. */
export function resolveGraphqlUrl(env: string): string | undefined {
  if (!ENVS.includes(env as EnvironmentName)) return undefined;
  return process.env[`GRAPHQL_URL_${env.toUpperCase()}`] || undefined;
}

export function configuredEnvironments(): { name: EnvironmentName; configured: boolean }[] {
  return ENVS.map((name) => ({ name, configured: !!resolveGraphqlUrl(name) }));
}

export const defaultEnvironment = (): EnvironmentName => {
  const d = process.env.DEFAULT_ENVIRONMENT as EnvironmentName | undefined;
  return d && ENVS.includes(d) ? d : 'dev';
};

/** Ambientes estáticos soportados. Cada uno corresponde a un workspace de Terraform y a una rama de Git. */
export const ENVIRONMENTS = ['dev', 'test', 'prod'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export interface BaseConfig {
  environment: Environment;
  serviceName: string;
  serviceVersion: string;
  /** stable | canary: permite medir la tasa de error del canary en CloudWatch. */
  deploymentTrack: string;
  port: number;
  aws: { region: string; endpoint?: string };
  cloudWatch: { enabled: boolean; logGroup: string };
  featureFlagsTable: string;
}

export function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Variable de entorno requerida no definida: ${name}`);
  }
  return value;
}

export function parseEnvironment(value: string): Environment {
  if ((ENVIRONMENTS as readonly string[]).includes(value)) return value as Environment;
  throw new Error(`Ambiente inválido "${value}". Valores permitidos: ${ENVIRONMENTS.join(', ')}`);
}

/** Convención de nombres compartida con Terraform: aegisvolt-<recurso>-<ambiente>. */
export const resourceName = (resource: string, env: Environment): string => `aegisvolt-${resource}-${env}`;

export function loadBaseConfig(serviceName: string, defaultPort: number): BaseConfig {
  const environment = parseEnvironment(requireEnv('ENVIRONMENT', 'dev'));
  return {
    environment,
    serviceName,
    serviceVersion: process.env.SERVICE_VERSION ?? 'local',
    deploymentTrack: process.env.DEPLOYMENT_TRACK ?? 'stable',
    port: Number(process.env.PORT ?? defaultPort),
    aws: {
      region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
      endpoint: process.env.AWS_ENDPOINT_URL || undefined,
    },
    cloudWatch: {
      enabled: (process.env.CLOUDWATCH_ENABLED ?? 'false') === 'true',
      logGroup: process.env.CLOUDWATCH_LOG_GROUP ?? `/aegisvolt/${environment}/${serviceName}`,
    },
    featureFlagsTable: process.env.FEATURE_FLAGS_TABLE ?? resourceName('feature-flags', environment),
  };
}

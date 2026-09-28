import { Amplify } from 'aws-amplify';

export interface RuntimeConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  restUrl: string;
  wsUrl: string;
}

let cached: RuntimeConfig | null = null;

export async function loadConfig(): Promise<RuntimeConfig> {
  if (cached) return cached;
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`config.json: HTTP ${res.status}`);
  cached = (await res.json()) as RuntimeConfig;
  Amplify.configure({ Auth: { Cognito: { userPoolId: cached.userPoolId, userPoolClientId: cached.clientId } } });
  return cached;
}

export function config(): RuntimeConfig {
  if (!cached) throw new Error('config not loaded');
  return cached;
}

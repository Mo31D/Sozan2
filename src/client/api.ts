export type HealthResponse = {
  ok: boolean;
  app: string;
  version: string;
  architecture: string;
  localModeAvailable: boolean;
  cloudDatabaseConfigured: boolean;
  cloudAccountsAvailable: boolean;
};

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Health check failed (${response.status})`);
  }

  return response.json() as Promise<HealthResponse>;
}

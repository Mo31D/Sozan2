export interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  APP_NAME?: string;
  APP_PASSCODE?: string;
  SESSION_SECRET?: string;
}

export function requireDatabase(env: Env): D1Database {
  if (!env.DB) {
    throw new Error('DATABASE_NOT_CONFIGURED');
  }

  return env.DB;
}

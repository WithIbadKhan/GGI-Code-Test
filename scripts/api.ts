/**
 * Development CLI that talks to the API the way a real client must:
 * access token from the identity provider, then a session, then signed requests.
 *
 *   npm run api -- ask "What is DDD?"
 *   npm run api -- usage --as bob
 *   npm run api -- metrics --admin
 *
 * Sessions are cached per user in .dev-idp/sessions.json (git-ignored).
 * Requires `npm run dev:idp` and `npm run dev` to be running.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { signRequest } from '../src/shared/security/requestSigning.js';

if (process.env.NODE_ENV === 'production') {
  console.error('This development CLI refuses to run with NODE_ENV=production.');
  process.exit(1);
}

const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`;
const IDP = 'http://localhost:4000';
const CACHE_FILE = '.dev-idp/sessions.json';

interface CachedSession {
  accessToken: string;
  sessionId: string;
  signingKey: string;
  expiresAt: string;
}

const HELP = `
Usage: npm run api -- <command> [args] [--as <name>] [--admin]

Default user: alice. --as <name> acts as another user; --admin acts as an admin.

Chat
  ask "<question>"            ask the AI (uses free quota first, then bundles)
  usage                       quota left this month
  history                     my chat messages

Subscriptions (tiers: BASIC, PRO, ENTERPRISE; cycles: MONTHLY, YEARLY)
  buy <TIER> <CYCLE>          e.g. buy BASIC MONTHLY  (add --no-renew to disable auto-renew)
  subs                        my subscriptions
  renew <id> on|off           turn auto-renew on or off
  cancel <id>                 cancel a subscription

Admin (use --admin)
  metrics                     system-wide usage and subscription metrics

Other
  health                      GET /health with the monitoring token from .env
  get <path>                  signed GET to any path
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    const [, value] = args.splice(i, 2);
    return value ?? '';
  };
  const hasFlag = (name: string) => {
    const i = args.indexOf(name);
    if (i !== -1) args.splice(i, 1);
    return i !== -1;
  };

  const admin = hasFlag('--admin');
  const noRenew = hasFlag('--no-renew');
  const user = flag('--as') ?? (admin ? 'admin' : 'alice');
  const [command, ...rest] = args;

  const client = new DevClient(`dev|${user}`, admin);

  switch (command) {
    case 'ask':
      return client.call('POST', '/api/v1/chat/messages', { question: rest.join(' ') });
    case 'usage':
      return client.call('GET', '/api/v1/chat/usage');
    case 'history':
      return client.call('GET', '/api/v1/chat/messages');
    case 'buy':
      return client.call('POST', '/api/v1/subscriptions', {
        tier: (rest[0] ?? '').toUpperCase(),
        billingCycle: (rest[1] ?? 'MONTHLY').toUpperCase(),
        autoRenew: !noRenew,
      });
    case 'subs':
      return client.call('GET', '/api/v1/subscriptions');
    case 'renew':
      return client.call('PATCH', `/api/v1/subscriptions/${rest[0] ?? ''}`, {
        autoRenew: rest[1] !== 'off',
      });
    case 'cancel':
      return client.call('POST', `/api/v1/subscriptions/${rest[0] ?? ''}/cancel`);
    case 'metrics':
      return client.call('GET', '/api/v1/admin/metrics');
    case 'get':
      return client.call('GET', rest[0] ?? '/');
    case 'health': {
      const res = await fetch(`${API}/health`, {
        headers: { 'X-Health-Token': process.env.HEALTH_CHECK_TOKEN ?? '' },
      });
      return print(res);
    }
    default:
      console.log(HELP);
  }
}

class DevClient {
  constructor(
    private readonly sub: string,
    private readonly admin: boolean,
  ) {}

  async call(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<void> {
    let res = await this.send(method, path, body);
    // The cached session may have been revoked or wiped: start a new one and retry once.
    if (res.status === 401) {
      this.forget();
      res = await this.send(method, path, body);
    }
    await print(res);
  }

  forget(): void {
    const remaining = Object.entries(readCache()).filter(([key]) => key !== this.cacheKey);
    writeCache(Object.fromEntries(remaining));
  }

  private get cacheKey(): string {
    return `${this.sub}${this.admin ? ' (admin)' : ''}`;
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const session = await this.session();
    const rawBody = body === undefined ? '' : JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('base64url');
    const signature = signRequest(session.signingKey, {
      method,
      url: path,
      timestamp,
      nonce,
      body: rawBody,
    });

    return fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Session-Id': session.sessionId,
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
        'X-Signature': signature,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: rawBody }),
    });
  }

  private async session(): Promise<CachedSession> {
    const cache = readCache();
    const cached = cache[this.cacheKey];
    if (cached && Date.parse(cached.expiresAt) > Date.now() + 60_000) return cached;

    const tokenUrl = `${IDP}/token?sub=${encodeURIComponent(this.sub)}${this.admin ? '&role=admin' : ''}`;
    const tokenRes = await fetch(tokenUrl).catch(() => {
      throw new Error(`Cannot reach the dev identity provider at ${IDP}. Run: npm run dev:idp`);
    });
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

    const sessionRes = await fetch(`${API}/api/v1/auth/session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {
      throw new Error(`Cannot reach the API at ${API}. Run: npm run dev`);
    });
    if (sessionRes.status !== 201) {
      await print(sessionRes);
      throw new Error('Could not open a session.');
    }
    const created = (await sessionRes.json()) as Omit<CachedSession, 'accessToken'>;

    const session = { accessToken, ...created };
    cache[this.cacheKey] = session;
    writeCache(cache);
    return session;
  }
}

async function print(res: Response): Promise<void> {
  const text = await res.text();
  console.log(`HTTP ${String(res.status)}`);
  if (!text) return;
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
}

function readCache(): Record<string, CachedSession> {
  return existsSync(CACHE_FILE)
    ? (JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Record<string, CachedSession>)
    : {};
}

function writeCache(cache: Record<string, CachedSession>): void {
  mkdirSync('.dev-idp', { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

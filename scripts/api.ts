/**
 * Development CLI that talks to the API the way a real client must:
 * access token from the identity provider, then a session, then signed requests.
 *
 *   npm run api -- login                 sign in with the real provider (e.g. Auth0)
 *   npm run api -- ask "What is DDD?"
 *   npm run api -- usage --as bob        (local dev provider only)
 *
 * Tokens and sessions are cached in .dev-idp/ (git-ignored).
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { signRequest } from '../src/shared/security/requestSigning.js';
import { loginWithBrowser, type OidcToken } from './oidcLogin.js';

if (process.env.NODE_ENV === 'production') {
  console.error('This development CLI refuses to run with NODE_ENV=production.');
  process.exit(1);
}

const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`;
const DEV_IDP = 'http://localhost:4000';
const CACHE_DIR = '.dev-idp';
const SESSIONS_FILE = `${CACHE_DIR}/sessions.json`;
const LOGIN_FILE = `${CACHE_DIR}/login.json`;

interface CachedSession {
  accessToken: string;
  sessionId: string;
  signingKey: string;
  expiresAt: string;
}

/** Who the CLI acts as: the account signed in with `login`, or a local dev user. */
type Identity = { kind: 'login'; token: OidcToken } | { kind: 'dev'; sub: string; admin: boolean };

const HELP = `
Usage: npm run api -- <command> [args] [--as <name>] [--admin]

Login
  login                       sign in with the real provider in your browser
  login --google              same, going straight to Google
  logout                      forget the login and use the local dev provider again

Without a login, the local dev provider is used (default user: alice).
--as <name> acts as another dev user; --admin acts as a dev admin.

Chat
  ask "<question>"            ask the AI (uses free quota first, then bundles)
  usage                       quota left this month
  history                     my chat messages

Subscriptions (tiers: BASIC, PRO, ENTERPRISE; cycles: MONTHLY, YEARLY)
  buy <TIER> <CYCLE>          e.g. buy BASIC MONTHLY  (add --no-renew to disable auto-renew)
  subs                        my subscriptions
  renew <id> on|off           turn auto-renew on or off
  cancel <id>                 cancel a subscription

Admin
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
  const google = hasFlag('--google');
  const user = flag('--as') ?? (admin ? 'admin' : 'alice');
  const [command, ...rest] = args;

  if (command === 'login') return login(google);
  if (command === 'logout') {
    logout();
    return;
  }

  const loggedIn = readLogin();
  const client = new ApiClient(
    loggedIn ? { kind: 'login', token: loggedIn } : { kind: 'dev', sub: `dev|${user}`, admin },
  );

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

async function login(google: boolean): Promise<void> {
  const issuer = process.env.AUTH_ISSUER ?? '';
  const clientId = process.env.OIDC_CLIENT_ID ?? '';
  const audience = process.env.AUTH_AUDIENCE ?? '';
  if (!issuer.startsWith('https://') || !clientId || !audience) {
    throw new Error(
      'Point AUTH_ISSUER, AUTH_JWKS_URI and AUTH_AUDIENCE at your provider and set OIDC_CLIENT_ID in .env first.',
    );
  }

  const token = await loginWithBrowser({
    issuer,
    clientId,
    audience,
    ...(google ? { connection: 'google-oauth2' } : {}),
  });
  writeJson(LOGIN_FILE, token);
  rmSync(SESSIONS_FILE, { force: true });
  console.log('Logged in. Commands now use your real account.');
}

function logout(): void {
  rmSync(LOGIN_FILE, { force: true });
  rmSync(SESSIONS_FILE, { force: true });
  console.log('Logged out. Commands use the local dev provider again.');
}

class ApiClient {
  constructor(private readonly identity: Identity) {}

  async call(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<void> {
    let res = await this.send(method, path, body);
    // The cached session may have expired or been wiped: start a new one and retry once.
    if (res.status === 401) {
      this.forgetSession();
      res = await this.send(method, path, body);
    }
    await print(res);
  }

  private get cacheKey(): string {
    const id = this.identity;
    return id.kind === 'login' ? 'login' : `${id.sub}${id.admin ? ' (admin)' : ''}`;
  }

  private forgetSession(): void {
    const remaining = Object.entries(readSessions()).filter(([key]) => key !== this.cacheKey);
    writeJson(SESSIONS_FILE, Object.fromEntries(remaining));
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
    const sessions = readSessions();
    const cached = sessions[this.cacheKey];
    if (cached && Date.parse(cached.expiresAt) > Date.now() + 60_000) return cached;

    const accessToken = await this.accessToken();
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
    sessions[this.cacheKey] = session;
    writeJson(SESSIONS_FILE, sessions);
    return session;
  }

  private async accessToken(): Promise<string> {
    const id = this.identity;
    if (id.kind === 'login') return id.token.accessToken;

    const url = `${DEV_IDP}/token?sub=${encodeURIComponent(id.sub)}${id.admin ? '&role=admin' : ''}`;
    const res = await fetch(url).catch(() => {
      throw new Error(`Cannot reach the dev identity provider at ${DEV_IDP}. Run: npm run dev:idp`);
    });
    return ((await res.json()) as { access_token: string }).access_token;
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

/** The saved login, if it has not expired. */
function readLogin(): OidcToken | null {
  if (!existsSync(LOGIN_FILE)) return null;
  const token = JSON.parse(readFileSync(LOGIN_FILE, 'utf8')) as OidcToken;
  return Date.parse(token.expiresAt) > Date.now() + 60_000 ? token : null;
}

function readSessions(): Record<string, CachedSession> {
  return existsSync(SESSIONS_FILE)
    ? (JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')) as Record<string, CachedSession>)
    : {};
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

/**
 * Browser login against a real OIDC provider (e.g. Auth0), using the OAuth2
 * Authorization Code flow with PKCE. Used by `npm run api -- login`.
 *
 * 1. Open the provider's login page (email/password or Google).
 * 2. Receive the authorization code on http://localhost:4001/callback.
 * 3. Exchange it for an access token for this API.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export interface OidcLoginOptions {
  issuer: string;
  clientId: string;
  audience: string;
  /** Optional provider hint, e.g. "google-oauth2" to skip straight to Google on Auth0. */
  connection?: string;
}

export interface OidcToken {
  accessToken: string;
  expiresAt: string;
}

const CALLBACK_PORT = 4001;
const REDIRECT_URI = `http://localhost:${String(CALLBACK_PORT)}/callback`;
const LOGIN_TIMEOUT_MS = 3 * 60_000;

export async function loginWithBrowser(options: OidcLoginOptions): Promise<OidcToken> {
  const discovery = await discover(options.issuer);

  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  const authorizeUrl = new URL(discovery.authorization_endpoint);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId,
    redirect_uri: REDIRECT_URI,
    audience: options.audience,
    scope: 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    ...(options.connection ? { connection: options.connection } : {}),
  }).toString();

  const codePromise = waitForCallback(state);
  console.log('Opening the login page in your browser. If it does not open, visit:');
  console.log(authorizeUrl.toString());
  openBrowser(authorizeUrl.toString());
  const code = await codePromise;

  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: options.clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
    }),
  });
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(`Token exchange failed: ${body.error_description ?? body.error ?? 'unknown'}`);
  }

  return {
    accessToken: body.access_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(),
  };
}

async function discover(
  issuer: string,
): Promise<{ authorization_endpoint: string; token_endpoint: string }> {
  const url = new URL(
    '.well-known/openid-configuration',
    issuer.endsWith('/') ? issuer : `${issuer}/`,
  );
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not read the provider configuration at ${url.toString()}`);
  }
  return (await response.json()) as { authorization_endpoint: string; token_endpoint: string };
}

/** Starts a one-shot local server that captures the authorization code. */
function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }

      const finish = (message: string, result: () => void) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end(message);
        clearTimeout(timer);
        server.close();
        result();
      };

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error_description') ?? url.searchParams.get('error');
      if (error) {
        finish(`Login failed: ${error}`, () => {
          reject(new Error(`Login failed: ${error}`));
        });
      } else if (url.searchParams.get('state') !== expectedState || !code) {
        finish('Login failed: invalid state.', () => {
          reject(new Error('Login failed: the state parameter did not match.'));
        });
      } else {
        finish('Login complete. You can close this tab.', () => {
          resolve(code);
        });
      }
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Login timed out.'));
    }, LOGIN_TIMEOUT_MS);

    server.listen(CALLBACK_PORT, '127.0.0.1');
  });
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).unref();
}

/**
 * Local development identity provider. NOT part of the application.
 *
 * It plays the role Auth0/Keycloak play in production: it publishes a public
 * key set (JWKS) and issues RS256-signed access tokens. The API verifies these
 * tokens with exactly the same code as in production (issuer, audience, expiry,
 * signature); only AUTH_ISSUER and AUTH_JWKS_URI in `.env` point here instead.
 *
 *   npm run dev:idp
 *   GET http://localhost:4000/.well-known/jwks.json
 *   GET http://localhost:4000/token?sub=alice&role=admin
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  SignJWT,
  type CryptoKey,
  type JWK,
} from 'jose';

const PORT = 4000;
const ISSUER = `http://localhost:${String(PORT)}/`;
const KEY_FILE = '.dev-idp/private-key.json';
const TOKEN_LIFETIME_SECONDS = 60 * 60;

if (process.env.NODE_ENV === 'production') {
  console.error('dev-idp refuses to run with NODE_ENV=production.');
  process.exit(1);
}

const audience = process.env.AUTH_AUDIENCE ?? 'https://api.ggi.local';
const rolesClaim = process.env.AUTH_ROLES_CLAIM ?? 'roles';

/** The key is kept on disk so tokens stay valid when this script restarts. */
async function loadOrCreateKey(): Promise<{ privateKey: CryptoKey; publicJwk: JWK }> {
  if (!existsSync(KEY_FILE)) {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    mkdirSync('.dev-idp', { recursive: true });
    writeFileSync(KEY_FILE, JSON.stringify(await exportJWK(privateKey)));
  }
  const privateJwk = JSON.parse(readFileSync(KEY_FILE, 'utf8')) as JWK;
  const privateKey = (await importJWK(privateJwk, 'RS256')) as CryptoKey;
  const { kty, n, e } = privateJwk;
  const publicJwk: JWK = { kty, n, e, alg: 'RS256', use: 'sig' };
  publicJwk.kid = await calculateJwkThumbprint(publicJwk);
  return { privateKey, publicJwk };
}

const { privateKey, publicJwk } = await loadOrCreateKey();

function issueToken(sub: string, roles: string[]): Promise<string> {
  return new SignJWT({ [rolesClaim]: roles })
    .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid ?? '' })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(`${String(TOKEN_LIFETIME_SECONDS)}s`)
    .sign(privateKey);
}

const SAFE_SUB = /^[A-Za-z0-9|@._-]{1,100}$/;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', ISSUER);
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  };

  if (req.method === 'GET' && url.pathname === '/.well-known/jwks.json') {
    send(200, { keys: [publicJwk] });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/token') {
    const sub = url.searchParams.get('sub') ?? 'dev|alice';
    if (!SAFE_SUB.test(sub)) {
      send(400, { error: 'invalid sub' });
      return;
    }
    const roles = url.searchParams.get('role') === 'admin' ? ['user', 'admin'] : ['user'];
    void issueToken(sub, roles).then((token) => {
      send(200, { access_token: token, token_type: 'Bearer', expires_in: TOKEN_LIFETIME_SECONDS });
    });
    return;
  }

  send(404, { error: 'not found' });
});

// Bound to loopback only: nothing outside this machine can reach it.
server.listen(PORT, '127.0.0.1', () => {
  void (async () => {
    const userToken = await issueToken('dev|alice', ['user']);
    console.log(`Dev identity provider running at ${ISSUER}`);
    console.log(`  JWKS:  ${ISSUER}.well-known/jwks.json`);
    console.log(`  Token: ${ISSUER}token?sub=dev|alice   (add &role=admin for an admin)\n`);
    console.log('Make sure .env contains:');
    console.log(`  AUTH_ISSUER=${ISSUER}`);
    console.log(`  AUTH_JWKS_URI=${ISSUER}.well-known/jwks.json\n`);
    console.log(`Token for "dev|alice" (valid 1 hour):\n\n${userToken}\n`);
  })();
});

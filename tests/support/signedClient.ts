import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import request, { type Test } from 'supertest';
import { signRequest } from '../../src/shared/security/requestSigning.js';
import type { FakeIdentityProvider } from './authKit.js';

export interface SignatureOverrides {
  sessionId?: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
  /** Sign this body, but send the real one (to simulate tampering). */
  signedBody?: string;
}

/**
 * Behaves like a real API client: gets an access token from the identity
 * provider, opens a session, and signs every request with the session key.
 */
export class SignedClient {
  private constructor(
    private readonly app: Express,
    readonly accessToken: string,
    readonly sessionId: string,
    readonly signingKey: string,
  ) {}

  static async create(
    app: Express,
    idp: FakeIdentityProvider,
    identity: { sub: string; roles?: string[] },
  ): Promise<SignedClient> {
    const accessToken = await idp.issueToken(identity);
    const res = await request(app)
      .post('/api/v1/auth/session')
      .set('Authorization', `Bearer ${accessToken}`);
    if (res.status !== 201) {
      throw new Error(
        `Could not open a session: ${String(res.status)} ${JSON.stringify(res.body)}`,
      );
    }
    const session = res.body as { sessionId: string; signingKey: string };
    return new SignedClient(app, accessToken, session.sessionId, session.signingKey);
  }

  get(path: string, overrides?: SignatureOverrides): Test {
    return this.send('GET', path, undefined, overrides);
  }

  post(path: string, body?: unknown, overrides?: SignatureOverrides): Test {
    return this.send('POST', path, body, overrides);
  }

  patch(path: string, body: unknown, overrides?: SignatureOverrides): Test {
    return this.send('PATCH', path, body, overrides);
  }

  /** Signs and sends a request, exactly as documented in requestSigning.ts. */
  send(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    overrides: SignatureOverrides = {},
  ): Test {
    const rawBody = body === undefined ? '' : JSON.stringify(body);
    const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
    const nonce = overrides.nonce ?? SignedClient.newNonce();
    const signature =
      overrides.signature ??
      signRequest(this.signingKey, {
        method,
        url: path,
        timestamp,
        nonce,
        body: overrides.signedBody ?? rawBody,
      });

    const agent = request(this.app);
    let req =
      method === 'GET' ? agent.get(path) : method === 'POST' ? agent.post(path) : agent.patch(path);
    req = req
      .set('Authorization', `Bearer ${this.accessToken}`)
      .set('X-Session-Id', overrides.sessionId ?? this.sessionId)
      .set('X-Timestamp', timestamp)
      .set('X-Nonce', nonce)
      .set('X-Signature', signature);
    return body === undefined ? req : req.set('Content-Type', 'application/json').send(rawBody);
  }

  static newNonce(): string {
    return randomBytes(16).toString('base64url');
  }
}

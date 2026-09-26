import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { JwtAccessTokenVerifier } from '../../src/shared/auth/JwtAccessTokenVerifier.js';

const TEST_ISSUER = 'https://idp.test.local/';
export const TEST_AUDIENCE = 'https://api.ggi.test';
const TEST_ROLES_CLAIM = 'https://ggi.local/roles';

/**
 * A stand-in for the external identity provider. It owns a real RSA key pair,
 * publishes the public key as a JWKS, and signs real JWTs. The application
 * verifies them with exactly the same code it uses in production. Only the
 * source of the keys is different, so authentication is mocked, not bypassed.
 */
export class FakeIdentityProvider {
  private constructor(
    private readonly privateKey: CryptoKey,
    readonly publicJwk: JWK,
  ) {}

  static async create(kid = 'test-key-1'): Promise<FakeIdentityProvider> {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
    return new FakeIdentityProvider(privateKey, publicJwk);
  }

  verifier(): JwtAccessTokenVerifier {
    return new JwtAccessTokenVerifier({
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      rolesClaim: TEST_ROLES_CLAIM,
      keys: createLocalJWKSet({ keys: [this.publicJwk] }),
    });
  }

  async issueToken(
    options: {
      sub?: string;
      roles?: string[];
      issuer?: string;
      audience?: string;
      /** Seconds from now; negative for an already-expired token. */
      expiresIn?: number;
    } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const jwt = new SignJWT({ [TEST_ROLES_CLAIM]: options.roles ?? ['user'] })
      .setProtectedHeader({ alg: 'RS256', kid: this.publicJwk.kid ?? 'test-key-1' })
      .setIssuer(options.issuer ?? TEST_ISSUER)
      .setAudience(options.audience ?? TEST_AUDIENCE)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + (options.expiresIn ?? 300));
    if (options.sub !== undefined) jwt.setSubject(options.sub);
    return jwt.sign(this.privateKey);
  }
}

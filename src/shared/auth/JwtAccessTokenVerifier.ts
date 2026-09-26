import { errors as joseErrors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { ROLES, type Actor, type Role } from '../domain/Actor.js';
import { AppError } from '../domain/errors.js';
import { tokenFingerprint } from '../security/requestSigning.js';

export interface VerifiedAccessToken {
  actor: Actor;
  /** SHA-256 of the raw token, used to bind a client session to this exact token. */
  fingerprint: string;
  expiresAt: Date;
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<VerifiedAccessToken>;
}

export interface JwtVerifierOptions {
  issuer: string;
  audience: string;
  /** Claim holding the roles; dotted paths such as `realm_access.roles` are supported. */
  rolesClaim: string;
  /**
   * Where signing keys come from. In production this is `createRemoteJWKSet`
   * pointing at the identity provider; in tests a local JWKS signs real tokens,
   * so verification is exercised rather than bypassed.
   */
  keys: JWTVerifyGetKey;
}

/** Only asymmetric algorithms: a shared-secret HS256 token must never be accepted. */
const ALLOWED_ALGORITHMS = ['RS256', 'PS256', 'ES256'];

/**
 * Verifies OAuth2/OIDC access tokens issued by the external identity provider.
 * We never issue tokens or handle passwords ourselves.
 */
export class JwtAccessTokenVerifier implements AccessTokenVerifier {
  constructor(private readonly options: JwtVerifierOptions) {}

  async verify(token: string): Promise<VerifiedAccessToken> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.options.keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ALLOWED_ALGORITHMS,
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5,
      }));
    } catch (error) {
      throw new AppError('UNAUTHENTICATED', describeFailure(error), undefined, { cause: error });
    }

    if (!payload.sub || payload.exp === undefined) {
      throw new AppError('UNAUTHENTICATED', 'The access token is invalid.');
    }

    return {
      actor: { userId: payload.sub, roles: this.extractRoles(payload) },
      fingerprint: tokenFingerprint(token),
      expiresAt: new Date(payload.exp * 1000),
    };
  }

  /** Unknown roles are ignored. Every authenticated caller is at least a `user`. */
  private extractRoles(payload: JWTPayload): Role[] {
    const raw = readPath(payload, this.options.rolesClaim);
    const claimed = Array.isArray(raw) ? raw.filter(isRole) : [];
    return claimed.includes('user') ? claimed : ['user', ...claimed];
  }
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Namespaced claims such as `https://ggi.local/roles` contain dots themselves,
 * so an exact key match is tried before treating the name as a dotted path.
 */
function readPath(source: JWTPayload, path: string): unknown {
  if (path in source) return source[path];

  let current: unknown = source;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** The message is deliberately generic, so it never tells an attacker which check failed. */
function describeFailure(error: unknown): string {
  if (error instanceof joseErrors.JWTExpired) return 'The access token has expired.';
  return 'The access token is invalid.';
}

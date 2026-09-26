export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/**
 * The authenticated caller, as seen by the domain. It is built from a verified
 * access token by the HTTP layer and passed explicitly into every use case.
 */
export interface Actor {
  /** Stable subject identifier issued by the identity provider (`sub` claim). */
  readonly userId: string;
  readonly roles: readonly Role[];
}

export function hasRole(actor: Actor, role: Role): boolean {
  return actor.roles.includes(role);
}

export function isAdmin(actor: Actor): boolean {
  return hasRole(actor, 'admin');
}

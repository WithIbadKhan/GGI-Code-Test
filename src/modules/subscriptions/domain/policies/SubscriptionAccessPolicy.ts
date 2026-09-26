import { hasRole, isAdmin, type Actor } from '../../../../shared/domain/Actor.js';
import type { Subscription } from '../entities/Subscription.js';

/**
 * Domain-level authorization for subscriptions, enforced inside every use case
 * in addition to the role checks on the routes.
 */
export const SubscriptionAccessPolicy = {
  /** Users buy bundles for themselves only; the owner is always the caller. */
  canPurchase(actor: Actor): boolean {
    return hasRole(actor, 'user') || isAdmin(actor);
  },

  canView(actor: Actor, subscription: Subscription): boolean {
    return subscription.userId === actor.userId || isAdmin(actor);
  },

  canManage(actor: Actor, subscription: Subscription): boolean {
    return subscription.userId === actor.userId || isAdmin(actor);
  },

  canListFor(actor: Actor, targetUserId: string): boolean {
    return targetUserId === actor.userId || isAdmin(actor);
  },
} as const;

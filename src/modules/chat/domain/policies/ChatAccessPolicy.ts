import { hasRole, isAdmin, type Actor } from '../../../../shared/domain/Actor.js';
import type { ChatMessage } from '../entities/ChatMessage.js';

/**
 * Domain-level authorization for the chat module. Controllers also check roles,
 * but these rules are enforced again here so that no use case can be reached
 * with the wrong permissions, whatever the entry point.
 */
export const ChatAccessPolicy = {
  canAsk(actor: Actor): boolean {
    return hasRole(actor, 'user') || isAdmin(actor);
  },

  canView(actor: Actor, message: ChatMessage): boolean {
    return message.userId === actor.userId || isAdmin(actor);
  },

  /** Users may only list or inspect their own history and usage; admins may see anyone's. */
  canAccessUserData(actor: Actor, targetUserId: string): boolean {
    return targetUserId === actor.userId || isAdmin(actor);
  },
} as const;

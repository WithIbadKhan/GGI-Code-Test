import { describe, expect, it } from 'vitest';
import { ChatMessage } from '../../../src/modules/chat/domain/entities/ChatMessage.js';
import { FREE_QUOTA } from '../../../src/modules/chat/domain/entities/QuotaSource.js';
import { UsagePeriod } from '../../../src/modules/chat/domain/entities/UsagePeriod.js';
import { ChatAccessPolicy } from '../../../src/modules/chat/domain/policies/ChatAccessPolicy.js';
import type { Actor } from '../../../src/shared/domain/Actor.js';

const alice: Actor = { userId: 'alice', roles: ['user'] };
const bob: Actor = { userId: 'bob', roles: ['user'] };
const admin: Actor = { userId: 'root', roles: ['user', 'admin'] };
const noRoles: Actor = { userId: 'ghost', roles: [] };

const alicesMessage = ChatMessage.reserve({
  id: 'm1',
  userId: 'alice',
  question: 'hi',
  quotaSource: FREE_QUOTA,
  usagePeriod: UsagePeriod.containing(new Date()),
  requestId: null,
  now: new Date(),
});

describe('ChatAccessPolicy', () => {
  it('lets users and admins ask, but not callers without a role', () => {
    expect(ChatAccessPolicy.canAsk(alice)).toBe(true);
    expect(ChatAccessPolicy.canAsk(admin)).toBe(true);
    expect(ChatAccessPolicy.canAsk(noRoles)).toBe(false);
  });

  it('lets a user view only their own messages', () => {
    expect(ChatAccessPolicy.canView(alice, alicesMessage)).toBe(true);
    expect(ChatAccessPolicy.canView(bob, alicesMessage)).toBe(false);
  });

  it('lets an admin view any message', () => {
    expect(ChatAccessPolicy.canView(admin, alicesMessage)).toBe(true);
  });

  it("restricts access to another user's history and usage to admins", () => {
    expect(ChatAccessPolicy.canAccessUserData(alice, 'alice')).toBe(true);
    expect(ChatAccessPolicy.canAccessUserData(bob, 'alice')).toBe(false);
    expect(ChatAccessPolicy.canAccessUserData(admin, 'alice')).toBe(true);
  });
});

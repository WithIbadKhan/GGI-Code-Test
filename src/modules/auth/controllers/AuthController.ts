import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentAccessToken, currentActor } from '../../../shared/http/middleware/authenticate.js';
import { parseInput } from '../../../shared/http/validation.js';
import type { SessionService } from '../domain/services/SessionService.js';

const emptyBody = z.strictObject({});

export class AuthController {
  constructor(private readonly sessions: SessionService) {}

  /**
   * POST /api/v1/auth/session
   * Exchanges a valid access token for a session and its signing key. This is
   * the only route that accepts a bare access token.
   */
  createSession = async (req: Request, res: Response): Promise<void> => {
    parseInput(emptyBody, req.body ?? {});

    const { session, signingKey } = await this.sessions.start(
      currentActor(req),
      currentAccessToken(req),
    );

    // The response carries a secret: it must never be cached anywhere.
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({
      sessionId: session.id,
      signingKey,
      expiresAt: session.expiresAt.toISOString(),
    });
  };
}

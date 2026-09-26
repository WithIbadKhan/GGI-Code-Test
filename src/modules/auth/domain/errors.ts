import { AppError } from '../../../shared/domain/errors.js';

export type SignatureFailure =
  'STALE_TIMESTAMP' | 'INVALID_SESSION' | 'BAD_SIGNATURE' | 'REPLAYED_NONCE';

const MESSAGES: Record<SignatureFailure, string> = {
  STALE_TIMESTAMP: 'The request timestamp is too old or too far in the future.',
  INVALID_SESSION: 'The session is unknown, expired or bound to a different token.',
  BAD_SIGNATURE: 'The request signature is invalid.',
  REPLAYED_NONCE: 'This nonce has already been used.',
};

export class InvalidSignatureError extends AppError {
  constructor(readonly reason: SignatureFailure) {
    super('INVALID_SIGNATURE', MESSAGES[reason], { reason });
  }
}

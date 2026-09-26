import { sanitizePlainText } from '../../../../shared/security/sanitize.js';
import { AiProviderUnavailableError } from '../../domain/errors.js';
import type { AiCompletion, AiProvider } from '../../domain/ports/AiProvider.js';

/**
 * Decorator that treats every AI answer as untrusted input: a model can be
 * prompt-injected into returning HTML or script, so the answer is sanitized
 * before it is stored or returned, whichever provider produced it.
 */
export class SanitizingAiProvider implements AiProvider {
  constructor(private readonly inner: AiProvider) {}

  async ask(question: string): Promise<AiCompletion> {
    const completion = await this.inner.ask(question);
    const answer = sanitizePlainText(completion.answer);
    if (answer.length === 0) {
      throw new AiProviderUnavailableError('The AI answer was empty after sanitization.');
    }
    return { ...completion, answer };
  }
}

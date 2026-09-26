import { ApiError, GoogleGenAI } from '@google/genai';
import { AppError } from '../../../../shared/domain/errors.js';
import { AiProviderUnavailableError, AiTimeoutError } from '../../domain/errors.js';
import type { AiCompletion, AiProvider } from '../../domain/ports/AiProvider.js';

export interface GeminiAiProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens?: number;
}

const SYSTEM_INSTRUCTION =
  'You are a helpful assistant. Answer clearly and concisely in plain text.';

/**
 * Real provider backed by Google Gemini (`@google/genai`). Enabled with
 * AI_PROVIDER=gemini. It maps Gemini's `usageMetadata` onto our provider-neutral
 * token usage and translates SDK errors into domain errors.
 */
export class GeminiAiProvider implements AiProvider {
  private readonly client: GoogleGenAI;

  constructor(private readonly options: GeminiAiProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
  }

  async ask(question: string): Promise<AiCompletion> {
    try {
      const response = await this.client.models.generateContent({
        model: this.options.model,
        contents: question,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          maxOutputTokens: this.options.maxOutputTokens ?? 1024,
          // Stops waiting on our side. Google may still bill a request it already started.
          abortSignal: AbortSignal.timeout(this.options.timeoutMs),
        },
      });

      const answer = response.text?.trim();
      if (!answer) {
        // Empty text usually means the answer was blocked by safety filters.
        throw new AiProviderUnavailableError('Gemini returned an empty answer.');
      }

      const usage = response.usageMetadata;
      const promptTokens = usage?.promptTokenCount ?? 0;
      // "Thinking" tokens are billed as output, so they count towards completion.
      const completionTokens =
        (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);

      return {
        answer,
        promptTokens,
        completionTokens,
        totalTokens: Math.max(usage?.totalTokenCount ?? 0, promptTokens + completionTokens),
        provider: 'gemini',
        model: response.modelVersion ?? this.options.model,
      };
    } catch (error) {
      throw toDomainError(error);
    }
  }
}

function toDomainError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new AiTimeoutError(error);
  }
  // The original error is kept as `cause` so it is logged, but its message
  // (which may contain upstream details) is never sent to the client.
  if (error instanceof ApiError && error.status === 429) {
    return new AiProviderUnavailableError(
      'The AI provider is rate limiting requests. Please try again shortly.',
      error,
    );
  }
  return new AiProviderUnavailableError(undefined, error);
}

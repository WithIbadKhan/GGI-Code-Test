/** Provider-neutral result of one AI completion. */
export interface AiCompletion {
  answer: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  provider: string;
  model: string;
}

/**
 * Port for "ask a language model". Implementations live in
 * `infrastructure/ai` (a mocked OpenAI provider and a Gemini provider).
 *
 * Implementations must throw `AiProviderUnavailableError` or `AiTimeoutError`
 * on failure, so the use case can refund the quota and return a typed error.
 */
export interface AiProvider {
  ask(question: string): Promise<AiCompletion>;
}

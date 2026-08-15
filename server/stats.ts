type StreamTextResult = ReturnType<(typeof import('ai'))['streamText']>;

export interface ConversationStats {
  type: 'conversation_stats';
  contextTokens: number;
  contextWindow: number;
  pp: number | undefined;
  tp: number | undefined;
}

export function getContextWindow(): number {
  const parsed = parseInt(process.env.MODEL_CONTEXT_WINDOW ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8192;
}

export async function extractStats(
  result: StreamTextResult
): Promise<ConversationStats> {
  const [usage, steps] = await Promise.all([result.usage, result.steps]);
  const lastStep = steps[steps.length - 1];
  return {
    type: 'conversation_stats',
    contextTokens: usage.inputTokens ?? 0,
    contextWindow: getContextWindow(),
    pp: lastStep.performance.inputTokensPerSecond,
    tp: lastStep.performance.outputTokensPerSecond,
  };
}

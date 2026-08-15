import { streamText } from 'ai';
import type { ToolSet } from 'ai';
import { createCodeTool } from '@cloudflare/codemode/ai';
import { systemPrompt, traditionalPrompt } from './prompt';
import { localNodeExecutor } from './executor';
import type { McpManager } from './mcp-manager';
import { getModel } from './provider';
import type { AgentMode } from './mode-store';

export interface RunAgentParams {
  mode: AgentMode;
  mcpManager: McpManager;
  conversationId?: string;
  instructions?: string;
  messages?: Parameters<typeof streamText>[0]['messages'];
  prompt?: string;
  stopWhen?: Parameters<typeof streamText>[0]['stopWhen'];
}

export async function runAgent(
  params: RunAgentParams
): Promise<ReturnType<typeof streamText>> {
  const {
    mode,
    mcpManager,
    conversationId,
    instructions,
    messages,
    prompt,
    stopWhen,
  } = params;

  const mappedTools = await mcpManager.getAllMappedTools({ conversationId });

  const tools: ToolSet =
    mode === 'traditional'
      ? (mappedTools as ToolSet)
      : {
          codemode: createCodeTool({
            tools: mappedTools,
            executor: localNodeExecutor,
          }),
        };

  const options = {
    model: getModel(),
    instructions:
      instructions ??
      (mode === 'traditional' ? traditionalPrompt : systemPrompt),
    ...(messages ? { messages } : prompt ? { prompt } : {}),
    tools,
    maxRetries: 1,
    prepareStep: ({ messages: stepMessages }) => ({
      messages: stepMessages.map((message) =>
        message.role === 'assistant'
          ? {
              ...message,
              content: Array.isArray(message.content)
                ? message.content.filter((part) => part.type !== 'reasoning')
                : message.content,
            }
          : message
      ),
    }),
    ...(stopWhen ? { stopWhen } : {}),
  } as Parameters<typeof streamText>[0];

  return streamText(options);
}

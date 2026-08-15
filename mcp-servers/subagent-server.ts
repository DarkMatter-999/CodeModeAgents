import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { isStepCount } from 'ai';
import dotenv from 'dotenv';
import { runAgent } from '../server/agent';
import { ModeStore } from '../server/mode-store';
import { McpManager } from '../server/mcp-manager';
import { getMcpServersConfig } from '../server/mcp-servers-config';

dotenv.config();

const redisPublisher = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379');

const server = new McpServer({
  name: 'Subagent-Server',
  version: '1.0.0',
});

const subagentMcpManager = new McpManager();

const subagentModeStore = new ModeStore();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const publishEvent = (conversationId: string, event: any) => {
  redisPublisher.publish(
    `conversation:${conversationId}`,
    JSON.stringify(event)
  );
};

server.registerTool(
  'run_subagent',
  {
    description:
      'Runs a subagent loop to solve a specific task. Use this to delegate complex work to an autonomous subagent.',
    inputSchema: {
      systemPrompt: z
        .string()
        .default(
          'You are a helpful and precise assistant for solving the following task. Use tools as needed, and think step by step.'
        )
        .describe(
          'The system prompt defining the persona and constraints for the subagent.'
        ),
      task: z
        .string()
        .describe(
          'The specific, detailed task the subagent should accomplish.'
        ),
      conversationId: z.string().optional(),
    },
  },
  async ({ systemPrompt, task, conversationId }) => {
    if (!conversationId) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Error: missing injected conversationId context.',
          },
        ],
      };
    }

    const subagentId = uuidv4();

    publishEvent(conversationId, {
      type: 'subagent_started',
      subagentId,
      task,
    });

    try {
      const parentMode = conversationId
        ? ((await subagentModeStore.getMode(conversationId)) ?? 'traditional')
        : 'traditional';

      const result = await runAgent({
        mode: parentMode,
        mcpManager: subagentMcpManager,
        conversationId,
        instructions: systemPrompt,
        prompt: task,
        stopWhen: isStepCount(10),
      });

      let fullText = '';
      let isToolCalling = false;

      for await (const chunk of result.stream) {
        if (chunk.type === 'text-delta') {
          fullText += chunk.text;
          publishEvent(conversationId, {
            type: 'subagent_update',
            subagentId,
            text: fullText,
          });
        } else if (chunk.type === 'tool-call') {
          if (!isToolCalling) {
            isToolCalling = true;
            publishEvent(conversationId, {
              type: 'subagent_tool_start',
              subagentId,
            });
          }
        } else if (chunk.type === 'tool-result') {
          isToolCalling = false;
        }
      }

      const finalResponse = await result.text;

      publishEvent(conversationId, {
        type: 'subagent_finished',
        subagentId,
        result: finalResponse,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Subagent ${subagentId} finished successfully. Result:\n${finalResponse}`,
          },
        ],
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      publishEvent(conversationId, {
        type: 'subagent_error',
        subagentId,
        error: error.message || 'Unknown error occurred in subagent',
      });
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Subagent ${subagentId} failed: ${error.message}`,
          },
        ],
      };
    }
  }
);

async function main() {
  const serversConfig = getMcpServersConfig([
    'Subagent-Server',
    'Canvas-Server',
  ]);
  await Promise.all(
    serversConfig.map((serverConfig) =>
      subagentMcpManager.registerServer(serverConfig)
    )
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);

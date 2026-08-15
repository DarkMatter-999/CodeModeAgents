import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import Redis from 'ioredis';
import cors from 'cors';
import {
  convertToModelMessages,
  generateId,
  toUIMessageStream,
  pipeUIMessageStreamToResponse,
} from 'ai';
import type { UIMessage } from 'ai';
import dotenv from 'dotenv';
import { McpManager } from './mcp-manager';
import { ModeStore } from './mode-store';
import { runAgent } from './agent';
import { getMcpServersConfig } from './mcp-servers-config';
import { extractStats } from './stats';

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT ?? '3000', 10);

app.use(cors());
app.use(express.json({ limit: '16mb' }));

const mcpManager = new McpManager();
const modeStore = new ModeStore();

const setupMcp = async () => {
  console.log('Initializing MCP Servers...');
  const servers = getMcpServersConfig();
  await Promise.all(servers.map((s) => mcpManager.registerServer(s)));
  console.log('MCP Servers Ready.');
};

setupMcp().catch(console.error);

app.post('/api/chat', async (req, res) => {
  const { messages, conversationId } = req.body as {
    messages: UIMessage[];
    conversationId?: string;
  };
  const requestedMode = (req.body as { mode?: string }).mode ?? 'traditional';

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }
  if (!conversationId) {
    res.status(400).json({ error: 'conversationId is required' });
    return;
  }

  try {
    const existingMode = await modeStore.getMode(conversationId);
    let mode: 'traditional' | 'codemode';
    if (existingMode === undefined) {
      mode = requestedMode === 'codemode' ? 'codemode' : 'traditional';
      await modeStore.setMode(conversationId, mode);
    } else if (existingMode !== requestedMode) {
      res
        .status(409)
        .json({ error: 'Agent mode is locked for this conversation' });
      return;
    } else {
      mode = existingMode;
    }

    const sanitizedMessages = messages.map((message) => {
      if (message.role !== 'assistant') return message;
      return {
        ...message,
        parts: message.parts.filter((part) => part.type !== 'reasoning'),
      };
    });

    const modelMessages = await convertToModelMessages(sanitizedMessages);

    const result = await runAgent({
      mode,
      mcpManager,
      conversationId,
      messages: modelMessages,
    });

    const uiStream = toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      generateMessageId: generateId,
    });

    await pipeUIMessageStreamToResponse({ stream: uiStream, response: res });

    if (conversationId) {
      try {
        const stats = await extractStats(result);
        await redisPublisher.publish(
          `conversation:${conversationId}`,
          JSON.stringify(stats)
        );
      } catch (err) {
        console.error('Failed to publish conversation stats:', err);
      }
    }
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Failed to stream response' });
  }
});

// WebSocket Setup
const wss = new WebSocketServer({ server });
const wsClients = new Map<string, Set<WebSocket>>();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const conversationId = url.searchParams.get('conversationId');

  if (!conversationId) {
    ws.close(1008, 'conversationId is required');
    return;
  }

  if (!wsClients.has(conversationId)) {
    wsClients.set(conversationId, new Set());
  }
  const clientSet = wsClients.get(conversationId)!;
  clientSet.add(ws);

  ws.on('close', () => {
    clientSet.delete(ws);
    if (clientSet.size === 0) {
      wsClients.delete(conversationId);
    }
  });
});

// Redis Subscriber Setup
const redisSubscriber = new Redis(
  process.env.REDIS_URL ?? 'redis://redis:6379'
);
const redisPublisher = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379');

redisSubscriber.psubscribe('conversation:*', (err, count) => {
  if (err) {
    console.error('Redis Subscribe Error:', err);
  } else {
    console.log(
      `Redis Subscribed to ${count} patterns (conversation channels)`
    );
  }
});

redisSubscriber.on('pmessage', (_pattern, channel, message) => {
  const match = channel.match(/^conversation:(.+)$/);
  if (match) {
    const conversationId = match[1];
    const clientSet = wsClients.get(conversationId);
    if (clientSet) {
      for (const ws of clientSet) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

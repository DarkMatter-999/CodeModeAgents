import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import dotenv from 'dotenv';
import { withRetry, getRetryConfig } from './retry';

dotenv.config();

const API_KEY = process.env.API_KEY ?? '';
const API_URL = process.env.API_URL ?? '';
const MODEL_NAME = process.env.MODEL_NAME ?? 'default-model';

export const provider = createOpenAICompatible({
  name: 'OpenAI-Compatible Provider',
  apiKey: API_KEY,
  baseURL: API_URL,
  includeUsage: true,
  fetch: withRetry(fetch, getRetryConfig()),
});

export const modelName = MODEL_NAME;

export const getModel = () => provider.chatModel(modelName);

import { register } from 'node:module';

register('./cloudflare-workers-hooks.mjs', import.meta.url);

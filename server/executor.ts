import * as vm from 'node:vm';

export interface ExecuteResult {
  result: unknown;
  error?: string;
  logs?: string[];
}

const sanitizeToolName = (name: string): string => {
  let sanitized = name.replace(/[-.\s]/g, '_');
  sanitized = sanitized.replace(/[^a-zA-Z0-9_$]/g, '');
  if (!sanitized) return '_';
  if (/^[0-9]/.test(sanitized)) sanitized = '_' + sanitized;
  return sanitized;
};

export const localNodeExecutor = {
  async execute(
    code: string,
    providersOrFns:
      | Array<{
          name: string;
          fns: Record<string, (...args: unknown[]) => Promise<unknown>>;
        }>
      | Record<string, (...args: unknown[]) => Promise<unknown>>,
    _options?: { connectors?: Array<{ name: string; binding: unknown }> }
  ): Promise<ExecuteResult> {
    const sandbox: Record<string, unknown> = {
      console: console,
      Promise: Promise,
    };

    if (Array.isArray(providersOrFns)) {
      for (const provider of providersOrFns) {
        const sanitizedFns: Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        > = {};
        for (const [name, fn] of Object.entries(provider.fns)) {
          const sanitized = sanitizeToolName(name);
          if (sanitizedFns[sanitized] && sanitizedFns[sanitized] !== fn) {
            return {
              result: undefined,
              error: `Tool names map to the same sanitized name "${sanitized}" in provider "${provider.name}"`,
            };
          }
          sanitizedFns[sanitized] = fn;
        }
        sandbox[provider.name] = sanitizedFns;
      }
    } else {
      sandbox.codemode = providersOrFns;
    }

    vm.createContext(sandbox);

    const script = new vm.Script(`(${code})()`, {
      filename: 'generated-code.js',
    });

    try {
      const result = await script.runInContext(sandbox, {
        timeout: 30000,
        displayErrors: true,
      });
      return { result };
    } catch (error: unknown) {
      console.error(error);
      return {
        result: undefined,
        error: error instanceof Error ? error.message : String(error),
        logs: [error instanceof Error ? error.stack : undefined].filter(
          (item): item is string => item !== undefined
        ),
      };
    }
  },
};

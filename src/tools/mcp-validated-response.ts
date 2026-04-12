import { z } from 'zod';
import { getLogger } from '../logging/context';

/**
 * When set to `1` or `true`, tool output validation uses Zod `.parse()` (fail fast).
 * Default: `safeParse` + warn + still return payload JSON.
 */
export function isStrictToolOutput(): boolean {
  const v = process.env.ECLASS_MCP_STRICT_TOOL_OUTPUT;
  if (v == null || v === '') return false;
  return v === '1' || v.toLowerCase() === 'true';
}

/**
 * Validate a JSON-serializable payload, return MCP single text content block.
 */
export function asValidatedMcpText<T>(
  toolName: string,
  schema: z.ZodType<T>,
  payload: unknown
): { content: [{ type: 'text'; text: string }] } {
  if (isStrictToolOutput()) {
    const data = schema.parse(payload);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    };
  }
  const r = schema.safeParse(payload);
  if (r.success) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(r.data) }],
    };
  }
  getLogger().warn(
    { tool: toolName, issues: r.error.issues },
    'tool output validation failed'
  );
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

/**
 * Validate a full MCP tool result object (e.g. multi-block `content`, optional `isError`).
 */
export function asValidatedMcpResult<T>(
  toolName: string,
  schema: z.ZodType<T>,
  result: unknown
): T {
  if (isStrictToolOutput()) {
    return schema.parse(result);
  }
  const r = schema.safeParse(result);
  if (r.success) {
    return r.data;
  }
  getLogger().warn(
    { tool: toolName, issues: r.error.issues },
    'MCP result validation failed'
  );
  return result as T;
}

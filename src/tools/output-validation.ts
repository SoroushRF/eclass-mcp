import { z } from 'zod';

/** Loose JSON: only non-null objects and arrays (not primitives). */
const LooseToolJsonPayloadSchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

function validateTextBlock(toolName: string, text: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  const r = LooseToolJsonPayloadSchema.safeParse(parsed);
  if (!r.success) {
    console.warn(
      `[eclass-mcp] Soft output validation (${toolName}): expected JSON object or array`,
      r.error.issues
    );
  }
}

export function isSoftOutputValidationEnabled(): boolean {
  const v = process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION;
  if (v == null || v === '') return false;
  const lower = v.toLowerCase();
  return lower === '1' || lower === 'true';
}

type ToolResultWithContent = {
  content: unknown;
};

export function applySoftOutputValidation<T extends ToolResultWithContent>(
  toolName: string,
  result: T
): T {
  if (!isSoftOutputValidationEnabled()) {
    return result;
  }
  const { content } = result;
  if (!Array.isArray(content)) {
    return result;
  }
  for (const item of content) {
    if (
      item &&
      typeof item === 'object' &&
      'type' in item &&
      (item as { type: unknown }).type === 'text' &&
      'text' in item &&
      typeof (item as { text: unknown }).text === 'string'
    ) {
      validateTextBlock(toolName, (item as { text: string }).text);
    }
  }
  return result;
}

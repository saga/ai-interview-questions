import { z } from 'zod';

export interface FormattedIssue {
  path: string;
  message: string;
}

function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return '';
  let out = String(path[0]);
  for (let i = 1; i < path.length; i++) {
    const seg = path[i];
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += `.${seg}`;
  }
  return out;
}

export function formatSchemaError(error: z.ZodError): FormattedIssue[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path as (string | number)[]),
    message: issue.message,
  }));
}

export function formatSchemaErrorMessage(error: z.ZodError, prefix?: string): string {
  const lines = formatSchemaError(error).map((i) => `${i.path || '(root)'} → ${i.message}`);
  return prefix ? `${prefix}\n${lines.join('\n')}` : lines.join('\n');
}

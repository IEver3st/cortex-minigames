// Serialise a plain JSON value as a Lua table literal for the playground's "copy Lua call" export.

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function toLua(value: unknown, indent = ''): string {
  const next = indent + '    ';
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : 'nil';
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return '{}';
    return `{\n${value.map((item) => next + toLua(item, next)).join(',\n')}\n${indent}}`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, v]) => `${next}${IDENT.test(k) ? k : `['${k}']`} = ${toLua(v, next)}`).join(',\n')}\n${indent}}`;
}

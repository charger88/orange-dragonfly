/**
 * Converts a camelCase or PascalCase identifier into dash-case text.
 *
 * @param s Input string.
 * @returns The converted dash-case string.
 */
export function camelCaseToDashCase(s: string): string {
  return s
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([a-z])(\d)/g, '$1-$2')
    .replace(/(\d)([a-zA-Z])/g, '$1-$2')
    .toLowerCase()
}

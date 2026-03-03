import { isDangerousKey } from './sanitize-input'

export interface MagicQueryParserOptions {
  integerParameters?: string[]
  booleanParameters?: string[]
  trueValues?: string[]
}

type QueryValue = string | number | boolean | null

const DEFAULT_TRUE_VALUES = ['1', 'true', 'TRUE', 'True']
const FROM_ARRAY = Symbol('qs_fromArray')
const OWNED_CONTAINER = Symbol('qs_ownedContainer')

type QueryArray = unknown[] & { [OWNED_CONTAINER]?: true }
type QueryNode = Record<string, unknown> & { [FROM_ARRAY]?: true, [OWNED_CONTAINER]?: true }
type QueryContainer = QueryNode | QueryArray

/**
 * Parser for query strings with bracket notation and coercion rules that produces nested objects and arrays.
 * Only empty brackets (`[]`) create arrays; numeric brackets such as `[0]`
 * remain ordinary object keys.
 */
export default class MagicQueryParser {

  private _integerParameters: Set<string>
  private _booleanParameters: Set<string>
  private _trueValues: Set<string>

  /**
   * Initializes internal state for this magic Query Parser.
   *
   * @param options Optional configuration values.
   */
  constructor(options: MagicQueryParserOptions = {}) {
    this._integerParameters = new Set(options.integerParameters ?? [])
    this._booleanParameters = new Set(options.booleanParameters ?? [])
    this._trueValues = new Set(options.trueValues ?? DEFAULT_TRUE_VALUES)
  }

  /**
   * Decodes a query-string token while preserving the original value if decoding fails.
   *
   * @param s Input string.
   * @returns Decoded token value, or the original token when decoding fails.
   */
  private _safeDecode(s: string | null): string {
    if (s == null) return ''
    s = String(s).replace(/\+/g, ' ')
    try { return decodeURIComponent(s) } catch { return s }
  }

  /**
   * Coerces a query-string value according to the parser coercion rules.
   *
   * @param v Input value.
   * @param key Lookup key.
   * @returns Coerced value for the configured key, or the original string/null value.
   */
  private _coerce(v: string | null, key: string, fallbackKey?: string): QueryValue {
    if (v === null) return null
    if (this._booleanParameters.has(key)) {
      return this._trueValues.has(v)
    }
    if (this._integerParameters.has(key) && /^-?\d+$/.test(v)) {
      return parseInt(v, 10)
    }
    if (fallbackKey != null && fallbackKey !== key) {
      if (this._booleanParameters.has(fallbackKey)) {
        return this._trueValues.has(v)
      }
      if (this._integerParameters.has(fallbackKey) && /^-?\d+$/.test(v)) {
        return parseInt(v, 10)
      }
    }
    return v
  }

  /**
   * Builds the lookup key used to match coercion rules for a query field path.
   *
   * @param path Path to process.
   * @returns The path key used for coercion lookup.
   */
  private _resolveCoercionKey(path: string[]): string {
    for (let i = path.length - 1; i >= 0; i--) {
      const token = path[i]
      if (token === '') continue
      // Numeric-looking child keys still inherit coercion from their nearest
      // named parent so configs like `integerParameters: ['n']` continue to
      // apply to `n[0]=1`, even though `[0]` is stored as an object key.
      if (i > 0 && /^\d+$/.test(token)) continue
      return token
    }
    return ''
  }

  /**
   * Provides a fallback coercion lookup using the literal leaf token so callers
   * can target numeric-looking child keys directly (for example
   * `integerParameters: ['0']` with `a[0]=1`).
   *
   * @param path Path to process.
   * @returns The literal leaf key, when it differs from the primary coercion key.
   */
  private _resolveLiteralCoercionFallbackKey(path: string[]): string | undefined {
    for (let i = path.length - 1; i >= 0; i--) {
      if (path[i] !== '') return path[i]
    }
    return undefined
  }

  /**
   * Parses a bracket-notation query key into path tokens used for nested assignment.
   *
   * @param key Lookup key.
   * @returns Parsed path tokens.
   */
  private _keyToPath(key: string): string[] {
    const out: string[] = []
    const re = /([^[\]]+)|\[(.*?)\]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(key)) !== null) {
      let t = m[1] != null ? m[1] : (m[2] ?? '')
      t = t.replace(/^['"]/, '').replace(/['"]$/, '')
      out.push(t)
    }
    return out.length ? out : [key]
  }

  /**
   * Checks whether a query path token should append to an array. Only empty
   * brackets (`[]`) create array semantics; numeric brackets are object keys.
   *
   * @param t Path token.
   * @returns True when the check succeeds.
   */
  private _isArrayAppendToken(t: string): boolean {
    return t === ''
  }

  /**
   * Marks a container as parser-owned so future writes may safely traverse it.
   *
   * @param container Container to mark.
   * @returns The same container.
   */
  private _markOwnedContainer<T extends QueryContainer>(container: T): T {
    if ((container as QueryNode | QueryArray)[OWNED_CONTAINER] === true) return container
    if (!Object.isExtensible(container)) return container
    Object.defineProperty(container, OWNED_CONTAINER, {
      value: true,
      enumerable: false,
      configurable: true,
    })
    return container
  }

  /**
   * Creates a new parser-owned container with the requested shape.
   *
   * @param wantsArray True when the container should be an array.
   * @returns A parser-owned container.
   */
  private _createContainer(wantsArray: boolean): QueryContainer {
    return wantsArray
      ? this._markOwnedContainer([] as QueryArray)
      : this._markOwnedContainer({} as QueryNode)
  }

  /**
   * Checks whether a value is a parser-owned container that may be traversed.
   *
   * @param value Candidate value.
   * @returns True when the value is safe to traverse.
   */
  private _isOwnedContainer(value: unknown): value is QueryContainer {
    if (Array.isArray(value)) return (value as QueryArray)[OWNED_CONTAINER] === true
    if (value === null || typeof value !== 'object') return false
    return (value as QueryNode)[OWNED_CONTAINER] === true
  }

  /**
   * Checks whether a path contains any dangerous key segment.
   *
   * @param path Parsed path tokens.
   * @returns True when a dangerous key is present.
   */
  private _hasDangerousPathSegment(path: string[]): boolean {
    return path.some(k => isDangerousKey(k))
  }

  /**
   * Converts array-like structures into objects when object notation is required.
   *
   * @param arr Array value.
   * @returns Object form of the sparse or array-like input.
   */
  private _arrayToObject(arr: unknown[]): QueryNode {
    const obj = this._markOwnedContainer({} as QueryNode)
    for (let i = 0; i < arr.length; i++) {
      if (Object.hasOwn(arr, i)) obj[i] = arr[i]
    }
    Object.defineProperty(obj, FROM_ARRAY, {
      value: true,
      enumerable: false,
      configurable: true,
    })
    return obj
  }

  /**
   * Finds the next numeric key to use when appending to an array that was
   * escalated into an object due to mixed array/object notation. We keep the
   * historic "property-count" starting point, but scan forward to avoid
   * overwriting an existing numeric key.
   *
   * @param obj Escalated array object.
   * @returns The next numeric string key.
   */
  private _nextArrayObjectIndex(obj: QueryNode): string {
    let index = Object.keys(obj).length
    while (Object.hasOwn(obj, String(index))) index++
    return String(index)
  }

  /**
   * Promotes the current array container into an object so non-empty bracket
   * tokens are stored as named properties instead of numeric array slots.
   *
   * @param arr Current array container.
   * @param parent Parent container, if any.
   * @param parentKey Key used to reach the current container.
   * @returns The promoted object container.
   */
  private _promoteArrayToObject(arr: unknown[], parent: QueryContainer | null, parentKey: string | number | null): QueryNode {
    const obj = this._arrayToObject(arr)
    if (parent != null && parentKey != null) {
      if (Array.isArray(parent)) {
        parent[parentKey as number] = obj
      } else {
        parent[parentKey as string] = obj
      }
    }
    return obj
  }

  /**
   * Writes a value into a nested object using parsed path tokens.
   *
   * @param root Root object.
   * @param path Path to process.
   * @param value Value to use.
   */
  private _setPath(root: QueryNode, path: string[], value: unknown): void {
    if (this._hasDangerousPathSegment(path)) return
    let cur: QueryContainer = root
    let parent: QueryContainer | null = null
    let parentKey: string | number | null = null

    for (let i = 0; i < path.length; i++) {
      const k = path[i]
      const last = i === path.length - 1
      const next = path[i + 1]

      // Any non-empty bracket token uses object semantics. Arrays are only for
      // `[]`, so promote them before handling named or numeric-looking keys.
      if (Array.isArray(cur) && k !== '') {
        cur = this._promoteArrayToObject(cur, parent, parentKey)
      }

      if (last) {
        if (k === '') {
          if (Array.isArray(cur)) {
            cur.push(value)
          } else {
            if (cur[FROM_ARRAY]) {
              cur[this._nextArrayObjectIndex(cur)] = value
            } else {
              cur[''] = value
            }
          }
        } else {
          ;(cur as QueryNode)[k] = value
        }
        return
      }

      // Intermediate: choose container type for next step
      const nextWantsArray = this._isArrayAppendToken(next)

      // Create / coerce child container
      if (k === '') {
        if (Array.isArray(cur)) {
          const child = this._createContainer(nextWantsArray)
          cur.push(child)
          parent = cur
          parentKey = cur.length - 1
          cur = child
        } else {
          if (!this._isOwnedContainer(cur[''])) cur[''] = this._createContainer(nextWantsArray)
          parent = cur
          parentKey = ''
          cur = cur[''] as QueryContainer
        }
        continue
      }

      if (Array.isArray(cur)) {
        cur = this._promoteArrayToObject(cur, parent, parentKey)
      }

      if (!this._isOwnedContainer(cur[k])) {
        cur[k] = this._createContainer(nextWantsArray)
      }
      parent = cur
      parentKey = k
      cur = cur[k] as QueryContainer
    }
  }

  /**
   * Sets a value at the path described by a bracket-notation key (e.g. `user[name]`,
   * `tags[]`, `items[0]`, `items[][id]`) inside an existing object. Handles the same nesting
   * and array-auto-creation logic as `parse()`. Safe against dangerous keys.
   * Useful for building structured objects from flat key-value sources such as
   * multipart/form-data fields, where values may be non-primitive (e.g. file buffers).
   *
   * @param obj Target object.
   * @param key Lookup key.
   * @param value Value to use.
   */
  applyToObject(obj: QueryNode, key: string, value: unknown): void {
    this._markOwnedContainer(obj)
    const path = this._keyToPath(key)
    if (this._hasDangerousPathSegment(path)) return
    if (path.length >= 2) {
      const base = path[0]
      const first = path[1]
      const wantsArray = this._isArrayAppendToken(first)
      if (!this._isOwnedContainer(obj[base])) {
        obj[base] = this._createContainer(wantsArray)
      }
    }
    this._setPath(obj, path, value)
  }

  /**
   * Parses the input and returns the normalized result.
   *
   * @param queryString Raw query string.
   * @returns The computed result.
   */
  parse(queryString: string): QueryNode {
    if (!queryString) return {}
    const qs = queryString.startsWith('?') ? queryString.slice(1) : queryString
    if (!qs) return {}

    const out = this._markOwnedContainer({} as QueryNode)

    for (const part of qs.split('&')) {
      if (!part) continue

      const eq = part.indexOf('=')
      const rawKey = eq === -1 ? part : part.slice(0, eq)
      const rawVal = eq === -1 ? null : part.slice(eq + 1)

      const key = this._safeDecode(rawKey)
      const path = this._keyToPath(key)
      if (this._hasDangerousPathSegment(path)) continue
      const coercionKey = this._resolveCoercionKey(path)
      const literalCoercionFallbackKey = this._resolveLiteralCoercionFallbackKey(path)
      const val = rawVal === null
        ? null
        : this._coerce(this._safeDecode(rawVal), coercionKey, literalCoercionFallbackKey)

      // Ensure base exists with a good initial type
      if (path.length >= 2) {
        const base = path[0]
        const first = path[1]
        const wantsArray = this._isArrayAppendToken(first)

        if (!this._isOwnedContainer(out[base])) {
          out[base] = this._createContainer(wantsArray)
        }
      }

      this._setPath(out, path, val)
    }

    return out
  }

}

const defaultParser = new MagicQueryParser()

/**
 * Parses a raw query string into a nested object using the framework query parser.
 *
 * @param queryString Raw query string.
 * @returns The computed result.
 */
export function parseQuery(queryString: string): QueryNode {
  return defaultParser.parse(queryString)
}

/**
 * Applies a single bracket-notation key-value pair to an existing object using
 * the default (no-coercion) MagicQueryParser. Shared between query-string and
 * multipart/form-data parsing so both use identical path-resolution logic.
 *
 * @param obj Target object.
 * @param key Lookup key.
 * @param value Value to use.
 */
export function applyKeyValueToObject(obj: QueryNode, key: string, value: unknown): void {
  defaultParser.applyToObject(obj, key, value)
}

/**
 * Helper for reading and converting environment variables into typed configuration values.
 */
export default class ODEnvConfigProvider {
  /**
   * Reads a raw environment variable value and applies an optional default when the variable is unset.
   *
   * @param name Environment variable name.
   * @param def Default value returned when the requested value is missing.
   * @returns Environment variable value, or the provided default when the variable is not set.
   */
  static param(name: string, def?: string): string | undefined {
    return process.env[name] ?? def
  }
    
  /**
   * Reads an environment variable as a string and applies an optional default value.
   *
   * @param name Environment variable name.
   * @param def Default value returned when the requested value is missing.
   * @returns Environment variable value as a string.
   */
  static str(name: string, def?: string): string {
    const v = process.env[name]
    if (v === undefined) {
      if (def === undefined) {
        throw new Error(`Required environment variable "${name}" is not defined`)
      }
      return def
    }
    return v
  }

  /**
   * Reads an environment variable and parses it as an integer, throwing when the value is invalid.
   *
   * @param name Environment variable name.
   * @param def Default value returned when the requested value is missing.
   * @returns Parsed integer value.
   */
  static int(name: string, def?: number): number {
    const v = process.env[name]
    if (v === undefined) {
      if (def === undefined) {
        throw new Error(`Required environment variable "${name}" is not defined`)
      }
      return def
    }
    if (!/^-?\d+$/.test(v)) {
      throw new Error(`Environment variable "${name}" must be a valid integer`)
    }
    const val = Number(v)
    if (!Number.isSafeInteger(val)) {
      throw new Error(`Environment variable "${name}" must be a valid safe integer`)
    }
    return val
  }
}

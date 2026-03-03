import ODApp from '../../core/app'
import { isDangerousKey } from '../../utils/sanitize-input'

/**
 * Command-line entry point that parses arguments and executes registered OD actions.
 */
export default class ODCommandLineInterface {
  /**
   * Parses CLI arguments, runs the requested action through the app, and logs the action result when one is returned.
   *
   * @param app Application instance.
   * @param inputData Raw command-line arguments array.
   */
  static async run(app: ODApp, inputData: string[]){
    const { action, input } = this.parseInputData(inputData)
    const res = await app.processAction(action, input)
    if (res !== undefined) {
      app.logger.info(res)
    }
  }

  /**
   * Converts CLI arguments into the action name and parameter payload expected by the app.
   *
   * @param inputData Raw command-line arguments array.
   */
  static parseInputData(inputData: string[]) {
    const action = inputData[2]
    const input: Record<string, string> = {}
    for (const arg of inputData.slice(3)) {
      const eqIdx = arg.indexOf('=')
      if (eqIdx === -1) continue
      const k = arg.slice(0, eqIdx)
      if (!k || isDangerousKey(k)) continue
      let v = arg.slice(eqIdx + 1)
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      input[k] = v
    }
    return { action, input }
  }
}

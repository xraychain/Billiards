import * as Constants from "../model/physics/constants"
import { TableConfig } from "../view/tableconfig"
import { RuleType } from "./types"

/**
 * The physics constants and table geometry are module-level state shared by
 * every table in the process, and configuring a pocket table changes `mu`.
 * Capture the tunables once and restore them before each engine call so a
 * match never inherits another rule type's settings.
 */
const defaults = {
  R: Constants.R,
  m: Constants.m,
  mu: Constants.mu,
  rho: Constants.rho,
  muS: Constants.muS,
  e: Constants.e,
  muC: Constants.muC,
  μs: Constants.μs,
  μw: Constants.μw,
  ee: Constants.ee,
  stronge_omega_ratio: Constants.stronge_omega_ratio,
  stronge_e_n: Constants.stronge_e_n,
  stronge_μ: Constants.stronge_μ,
}

export function configure(ruleType: RuleType): void {
  for (const [key, value] of Object.entries(defaults)) {
    ;(Constants as any)[`set${key}`](value)
  }
  TableConfig.apply(ruleType, 10)
}

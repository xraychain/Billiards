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
  sinθ: Constants.sinθ,
  sideSpin: Constants.sideSpin,
  μwFade: Constants.μwFade,
  tipReach: Constants.tipReach,
  tipLoss: Constants.tipLoss,
}

/**
 * Carom tables, fitted to the diamond system as professionals play it: full
 * running side (the tip's edge at the ball's edge, "15'lik"), centre
 * height, medium pace (half the power bar, see `shotLimits`), lines drawn between the diamonds' marks on the
 * cushion. The targets were the corner shot from every start with the
 * compensation players add (−5 at 25 … 0 at 50 … +10 at 90), met within a
 * tenth of a diamond, and the off-table check: lines from anywhere on the
 * table through one point beyond the 50–30 line all bring the ball to the
 * corner. A third: from a corner, straight down the long rail with full
 * side, the ball comes back off the far cushion into the opposite corner.
 * The rubber grips a little less the faster the ball runs along it
 * (μwFade), which lets shallow first-cushion angles run long.
 */
const CAROM = {
  // measured: UMB ball, Alciatore's tip model (TP A.30), miscue at 0.5 R
  R: 0.03075,
  m: 0.21,
  tipReach: 1.25,
  tipLoss: 2.22,
  // the cushion nose at 37 mm meets a 61.5 mm ball 0.203 R above centre
  sinθ: 0.203,
  // fitted to the systems; none is published for carom, and each sits by a
  // published model value: e 0.98 (Mathavan 2010), cushion friction 0.27
  // (JSME 2016), cloth sliding 0.18–0.25 (snooker, measured)
  ee: 0.989554,
  μw: 0.290319,
  μwFade: 0.530684,
  μs: 0.215669,
  muS: 0.181219,
  sideSpin: 0.763767,
}

export function configure(ruleType: RuleType): void {
  const carom = ruleType === "threecushion" || ruleType === "sagu"
  const values = carom ? { ...defaults, ...CAROM } : defaults
  for (const [key, value] of Object.entries(values)) {
    ;(Constants as any)[`set${key}`](value)
  }
  TableConfig.apply(ruleType, 10)
}

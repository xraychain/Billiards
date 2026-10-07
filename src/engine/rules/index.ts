import { RuleType } from "../types"
import { CaromRules } from "./carom"
import { saguRules } from "./sagu"
import { threeCushionRules } from "./threecushion"

export const RULES: Partial<Record<RuleType, CaromRules>> = {
  threecushion: threeCushionRules,
  sagu: saguRules,
}

export function rulesFor(ruleType: RuleType): CaromRules {
  const rules = RULES[ruleType]
  if (!rules) {
    throw new Error(`unknown ruleType: ${ruleType}`)
  }
  return rules
}

// ИН-П1 «знакомство, условия, согласия» (решение П34) — внешняя поверхность модуля.
// Запись согласия — кирпич К2, сервисы § 5.17–§ 5.19 — К3 и К4, экраны П1 и П3 — К5.
export type {
  AgentModel,
  AgentModelId,
  CompareLine,
  CompareRow,
  ConsentId,
  ConsentItem,
  OnboardingCatalog,
  OnboardingErrorKey,
  OnboardingScreenId,
  OnboardingText,
  ScreenTextKey,
  ScreenTexts,
  UiPathStep,
} from "./model.js";

export {
  AGENT_MODELS,
  COMPARE_ROWS,
  CONSENT_IDS,
  MONEY_PLACEHOLDER,
  ONBOARDING_ERROR_KEYS,
  ONBOARDING_SCREENS,
  SCREEN_TEXT_KEYS,
  isAgentModelId,
  isConsentId,
  modelById,
  parseOnboardingCatalog,
  pathStepOf,
} from "./model.js";

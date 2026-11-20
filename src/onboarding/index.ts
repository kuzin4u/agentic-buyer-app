// ИН-П1 «знакомство, условия, согласия» (решение П34) — внешняя поверхность модуля.
// Сервисы § 5.17–§ 5.19 — кирпичи К3 и К4, экраны П1 и П3 — К5.
// Поверхность собрана **целиком**, как у образца (`src/principles/index.ts`): в К2 шапка обещала запись согласия, а
// экспортов не было, и потребители ходили глубоким импортом (находка ревью К2 № 10).
export type {
  ConsentAcceptedEntry,
  ConsentJournal,
  ConsentStore,
  ConsentView,
  RecordConsentDeps,
  SignedConsent,
} from "./consent.js";

export { FIRST_CONSENT_NO, allRequiredAccepted, createConsentStore, nextConsentVersion, recordConsent } from "./consent.js";

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

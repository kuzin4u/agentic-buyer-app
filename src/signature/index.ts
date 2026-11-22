// ИН-П2 «подпись своего агента (М2)» (решение **Р-1703**) — внешняя поверхность модуля.
// Механика подписи — кирпич К3 (`m2.ts`); методы `/ui/v1` и экран П4 — кирпичи К4 и К5, в этой задаче не делаются.
// Поверхность собрана **целиком**, как у образцов (`src/onboarding/index.ts`, `src/principles/index.ts`): шапка,
// обещающая механику без экспортов, уже приводила к глубоким импортам у потребителей (находка ревью К2 № 10 ИН-П1).
export type {
  ApprovalLookup,
  PaymentApprovalJournal,
  PaymentApprovalRefusedEntry,
  PaymentApprovalStore,
  PaymentApprovedEntry,
  RecordApprovalDeps,
  SignedPaymentApproval,
} from "./m2.js";

export {
  FIRST_APPROVAL_NO,
  approvalFor,
  approvedByHuman,
  createPaymentApprovalStore,
  nextApprovalVersion,
  recordPaymentApproval,
} from "./m2.js";

// Серверная проверка ответа пасскея — кирпич К3а (П37 п. 3; Р-1716, Р-1720, Р-1721).
export type {
  ChallengeStore,
  CheckAssertionDeps,
  IssueChallengeDeps,
  PasskeyAssertion,
  PasskeyChallenge,
  PasskeyCheck,
  PasskeyPurpose,
  PasskeyRefusalCode,
  PasskeyRegistry,
  PasskeyVerifier,
  RegisteredPasskey,
  VerifyAssertionInput,
} from "./webauthn.js";

export {
  PASSKEY_PURPOSES,
  PASSKEY_REFUSAL_CODES,
  challengeValue,
  checkPaymentAssertion,
  createChallengeStore,
  issueChallenge,
  paymentShown,
  paymentShownHash,
} from "./webauthn.js";

export { createPasskeyVerifier } from "./passkey-verifier.js";

// Запись регистрации пасскея и реестр ключей — кирпич К2 (П37 п. 2, приём П32).
export type {
  PasskeyRegisteredEntry,
  PasskeyRegistrationJournal,
  PasskeyRegistrationRefusedEntry,
  RecordRegistrationDeps,
  RegistrationStore,
  SignedRegistration,
} from "./registration.js";

export {
  FIRST_REGISTRATION_NO,
  createPasskeyRegistry,
  createRegistrationStore,
  nextRegistrationVersion,
  recordRegistration,
} from "./registration.js";

export type { PasskeyRegistrationAnswer, VerifyRegistrationInput } from "./webauthn.js";

// Четыре метода `/ui/v1` формы П37 п. 3 — кирпич К4 (`PENDING_V1_6`).
export type { PasskeyOutcome, PasskeyServiceDeps } from "./service.js";

export {
  getPasskeyRegistration,
  passkeyRefusal,
  postPasskeyRegistration,
  postPaymentSignature,
  postPaymentSignatureChallenge,
  registrationShown,
} from "./service.js";

export { PASSKEY_REFUSAL_RETRY, PASSKEY_REFUSAL_STATUS } from "./webauthn.js";

// Данные экрана П4 и текст ПЭП — кирпич К1 (`config/passkey.default.json`).
export type { PasskeyCatalog, PasskeyScreenTexts, PasskeyTextCode, PepTexts } from "./texts.js";

export { PASSKEY_TEXT_CODES, parsePasskeyCatalog } from "./texts.js";

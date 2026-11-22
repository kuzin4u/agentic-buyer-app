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

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

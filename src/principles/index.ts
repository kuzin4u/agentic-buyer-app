// П-К1 «принципы как подписываемый объект» (решение П32, Р-1615) — внешняя поверхность профиля предпочтений.
// Веса наружу **не выходят**: `weights.ts` здесь не реэкспортируется (правка 6 канвы, правило 3 К-Б). Кто берёт
// веса — берёт их портом `weightsFor` (К1.4), а не картой.
export type {
  ChangeSource,
  KnownChangeSource,
  ErrorTextKey,
  NoteKey,
  PrinciplesErrorTexts,
  PrinciplesNotes,
  SignedBy,
  OrderCheck,
  OrderProblem,
  Principle,
  PrincipleCode,
  PrincipleId,
  PrincipleParams,
  PrincipleRole,
  PrincipleScope,
  PrincipleText,
  PrinciplesCatalog,
  PrinciplesOrder,
  PrinciplesView,
  SignedPrinciples,
} from "./model.js";

export type { PostOutcome, PrinciplesServiceDeps } from "./service.js";

export { RETRY_BY_CODE, getPrinciplesView, postPrinciples } from "./service.js";

export {
  article19Applied,
  currentPrinciples,
  lockedId,
  noteKeysFor,
  notesFor,
  ranksFor,
  weightsFor,
} from "./selection.js";

export type {
  BodyProblem,
  PrinciplesJournal,
  PrinciplesSignedEntry,
  PrinciplesStore,
  RememberedAnswer,
  SignDeps,
  SignErrorCode,
  SignOutcome,
  SignRequest,
} from "./signature.js";

export { bodyFingerprint, createPrinciplesStore, signPrinciples } from "./signature.js";

export {
  ERROR_TEXT_KEYS,
  FIRST_VERSION_NO,
  KNOWN_CHANGE_SOURCES,
  NOTE_KEYS,
  PRINCIPLE_ROLES,
  byRole,
  checkOrder,
  defaultOrder,
  isKnownChangeSource,
  knownOrder,
  nextVersion,
  parsePrinciplesCatalog,
} from "./model.js";

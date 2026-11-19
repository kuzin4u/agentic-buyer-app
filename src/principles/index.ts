// П-К1 «принципы как подписываемый объект» (решение П32, Р-1615) — внешняя поверхность профиля предпочтений.
// Веса наружу **не выходят**: `weights.ts` здесь не реэкспортируется (правка 6 канвы, правило 3 К-Б). Кто берёт
// веса — берёт их портом `weightsFor` (К1.4), а не картой.
export type {
  ChangeSource,
  KnownChangeSource,
  OrderCheck,
  OrderProblem,
  Principle,
  PrincipleCode,
  PrincipleId,
  PrincipleParams,
  PrincipleScope,
  PrincipleText,
  PrinciplesCatalog,
  PrinciplesOrder,
  PrinciplesView,
  SignedPrinciples,
} from "./model.js";

export {
  EXECUTION_CODE,
  FIRST_VERSION_NO,
  KNOWN_CHANGE_SOURCES,
  PRICE_CODE,
  REQUIRED_CODES,
  checkOrder,
  defaultOrder,
  isKnownChangeSource,
  nextVersion,
  parsePrinciplesCatalog,
} from "./model.js";

// П-К1, К1.2 — карта «ранг → вес». Модуль **наружу не выходит**: `index.ts` его не реэкспортирует, и в ответ экрану
// веса не попадают (правка 6 канвы; правило 3 К-Б — экран не взвешивает принципы). Экрану уходит только `rank`.
// Ст. 19 правил («вес исполнения не ниже веса цены») держит **сервер**, а не экран и не договорённость: порядок
// клиента принимается как есть, а вес цены выше веса исполнения не поднимается — и человеку это сказано строкой под
// списком (К1.4), а не скрыто.
import type { PrincipleCode, PrincipleId, PrinciplesCatalog, PrinciplesOrder } from "./model.js";
import { EXECUTION_CODE, PRICE_CODE } from "./model.js";

/** Вес первого по важности пункта. Шкала условная и наружу не видна: важны только отношения весов. */
const TOP_WEIGHT = 100;

/** Вес по месту в порядке: первый — `TOP_WEIGHT`, дальше равными шагами вниз, последний — `TOP_WEIGHT / m`.
 *  Выключенный пункт в порядок не входит и получает 0 (см. `weightsOf`). */
function weightAt(rank: number, m: number): number {
  return Math.round((TOP_WEIGHT * (m - rank + 1)) / m);
}

/** Что сделала ст. 19 с этим порядком — для строки-пояснения человеку (К1.4).
 *  **Строка собирается из `applied` и `execution_included`, без числа `ceiling`:** `ceiling` — вес, а веса наружу не
 *  выходят (правка 6 канвы, П32). Границу держит тест графа импортов — `weights.ts` ввозится только внутри
 *  `src/principles/`. */
export interface Article19 {
  /** вес цены был опущен до потолка */
  readonly applied: boolean;
  /** потолок веса цены, или `null`, если ст. 19 к этому порядку не относится. **В тело `GET` не уходит** */
  readonly ceiling: number | null;
  /** был ли принцип исполнения включён клиентом: при выключенном потолок берётся по умолчанию */
  readonly execution_included: boolean;
}

export interface Weights {
  /** вес каждого пункта перечня: включённые — по месту в порядке, выключенные — 0 */
  readonly byId: ReadonlyMap<PrincipleId, number>;
  readonly article19: Article19;
}

function idOfCode(catalog: PrinciplesCatalog, code: PrincipleCode): PrincipleId | null {
  return catalog.items.find((p) => p.code === code)?.id ?? null;
}

/** Веса по порядку клиента. Порядок уже проверен `checkOrder` (известные `id`, без повторов, не пустой).
 *
 *  Ст. 19: если цена включена, её вес не выше веса исполнения. Исполнение выключено — потолком берётся **вес
 *  исполнения по умолчанию**, то есть вес на его месте в перечне по умолчанию (решение владельца 19.11).
 *  **Нюанс для КТ1:** в перечне по умолчанию исполнение стоит первым, поэтому такой потолок равен верхнему весу и
 *  опустить цену не может — при выключенном исполнении правило не срабатывает ни на каком порядке. Своего толкования
 *  здесь не придумываем: вопрос вынесен на КТ1. */
export function weightsOf(order: PrinciplesOrder, catalog: PrinciplesCatalog): Weights {
  const m = order.length;
  const byId = new Map<PrincipleId, number>(catalog.items.map((p) => [p.id, 0]));
  order.forEach((id, i) => byId.set(id, weightAt(i + 1, m)));

  const executionId = idOfCode(catalog, EXECUTION_CODE);
  const priceId = idOfCode(catalog, PRICE_CODE);
  const priceIncluded = priceId !== null && order.includes(priceId);
  if (!priceIncluded || executionId === null || priceId === null)
    return { byId, article19: { applied: false, ceiling: null, execution_included: executionId !== null && order.includes(executionId) } };

  const executionIncluded = order.includes(executionId);
  const ceiling = executionIncluded
    ? (byId.get(executionId) ?? 0)
    : weightAt(catalog.items.findIndex((p) => p.id === executionId) + 1, catalog.items.length);
  const price = byId.get(priceId) ?? 0;
  const applied = price > ceiling;
  if (applied) byId.set(priceId, ceiling);
  return { byId, article19: { applied, ceiling, execution_included: executionIncluded } };
}

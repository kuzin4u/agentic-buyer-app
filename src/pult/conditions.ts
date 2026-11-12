// «Условия» пульта DEMO-2 (П-4.2; модель пульта 1.23 — «Контроль» → «Условия и предупреждения»: «Приоритет» — плитки узлов
// У1–У5 и светофоры восьми секторов, «Все 89» — справочник с поиском и фильтром по зоне). Чистые функции над результатом
// движка условий (`evaluate`): статус правила, узла и сектора — только из движка (инвариант 2), экран их не считает и не
// повышает. Единственный признак экрана — «внимание» у сектора по строкам «Идёт к нарушению» за порогом: это значок, а не
// статус (решение по плану П-4.2, уточнение 3).
// Состояние — сводно по системе (решение по плану П-4.2, вариант (б), Р-1495); состояние для транзакции в фокусе — после
// MVP (п. 10 списка «после MVP»), разбор по транзакции — П-5.1 «Причины».
import type { WireLang } from "../dashboards/wire.js";
import { NOTE_LABEL, ruleStatus, STATUS_LABEL, STATUSES, worstStatus, type CondStatus, type EngineView, type Note } from "./engine.js";
import {
  CHECKABLE_CONDITIONS,
  CONTROL_LABEL,
  COVERAGE_LABEL,
  EN_LATER,
  KIND_LABEL,
  NODES,
  PARTY_LABEL,
  POINTS,
  RULE_GROUPS,
  RULES89,
  ruleText,
  score,
  SECTORS,
  ZONE_LABEL,
  ZONES,
  type CheckableCondition,
  type ConditionId,
  type NodeId,
  type Point,
  type Rule89,
  type Sector,
} from "./rules89.js";

const checkable = (c: ConditionId): c is CheckableCondition => (CHECKABLE_CONDITIONS as readonly string[]).includes(c);

export interface NodeTile {
  readonly id: NodeId;
  /** Худший из сводных статусов условий узла; условие без проверки на стенде — «на стенде не проверяется». */
  readonly status: CondStatus;
  /** Транзакции и поручения, у которых условие узла в статусе плитки (только для «нарушено» и «сработало»). */
  readonly objs: readonly string[];
  /** Часть «нарушено» или «сработало» есть только сводно — записью системы без транзакции (запись стенда без привязки,
   *  П-3.2г): экран показывает «система» — одну или рядом с объектами (уточнение 1 к плану П-4.2; ревью П-4.2 № 2). */
  readonly system: boolean;
  /** Пометки к статусу плитки (например, «конфликт звеньев» у «ещё не дошло» — уточнение 2). */
  readonly notes: readonly Note[];
}

export interface SectorLight {
  readonly id: Sector;
  readonly status: CondStatus;
}

export interface ConditionsView {
  /** Статус каждого из 89 правил справочника — `ruleStatus` по сводным статусам условий. */
  readonly rules: Readonly<Record<string, CondStatus>>;
  readonly nodes: readonly NodeTile[];
  readonly sectors: readonly SectorLight[];
  /** Число правил по статусам — для счётчика «по всем транзакциям» (уточнение 5): экран список не пересчитывает. */
  readonly counts: Readonly<Partial<Record<CondStatus, number>>>;
}

const BAD_LIKE: ReadonlySet<CondStatus> = new Set(["bad", "fired"]);

/** Сводный статус условия; условие без проверки на стенде (нет среди 18) — «на стенде не проверяется». */
const sysStatus = (view: EngineView, c: ConditionId): CondStatus => (checkable(c) ? view.system[c].status : "none");

/** Состояние «Условий» по результату движка. `rules` — справочник (подмена — только для теста). */
export function conditionsView(view: EngineView, rules: readonly Rule89[] = RULES89): ConditionsView {
  const statuses: Record<string, CondStatus> = {};
  const counts: Partial<Record<CondStatus, number>> = {};
  for (const r of rules) {
    const s = ruleStatus(r, view.system);
    statuses[r.id] = s;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const nodes = (Object.keys(NODES) as NodeId[]).map((id): NodeTile => {
    const conds = NODES[id].conds as readonly ConditionId[];
    const status = worstStatus(conds.map((c) => sysStatus(view, c)), "none");
    const own = conds.filter(checkable);
    // Объекты — по движку: условие узла у объекта в статусе плитки. Порядок — порядок объектов движка.
    const objs = BAD_LIKE.has(status) ? view.objs.filter((o) => own.some((c) => o.conds[c].status === status)).map((o) => o.id) : [];
    const notes = new Set<Note>();
    // Часть системы: условие узла сводно в статусе плитки, а ни у одного объекта его нет (ревью П-4.2 № 2 — смешанный узел).
    let system = false;
    for (const c of own) {
      const sys = view.system[c];
      if (sys.status !== status) continue;
      if (sys.note) notes.add(sys.note);
      const at = view.objs.filter((o) => o.conds[c].status === status);
      for (const o of at) if (o.conds[c].note) notes.add(o.conds[c].note!);
      if (BAD_LIKE.has(status) && at.length === 0) system = true;
    }
    return { id, status, objs, system, notes: [...notes] };
  });
  const sectors = (Object.keys(SECTORS) as Sector[]).map((id): SectorLight => ({
    id,
    status: worstStatus((SECTORS[id].conds as readonly ConditionId[]).map((c) => sysStatus(view, c)), "none"),
  }));
  return { rules: statuses, nodes, sectors, counts };
}

/** Справочник для страницы пульта — только тексты языка экрана (П6 доп. 1: у правила без en — ru и пометка). Кладётся в
 *  страницу один раз (`jsonForScript`), а не в каждое сообщение ленты. */
export function rulesForPage(lang: WireLang, rules: readonly Rule89[] = RULES89) {
  const t = (x: Readonly<Record<WireLang, string>>) => x[lang];
  return {
    statuses: Object.fromEntries(STATUSES.map((s) => [s, t(STATUS_LABEL[s])])),
    notes: Object.fromEntries(Object.entries(NOTE_LABEL).map(([k, v]) => [k, t(v)])),
    zones: ZONES.map((z) => ({ id: z, name: t(ZONE_LABEL[z]) })),
    groups: Object.entries(RULE_GROUPS).map(([id, name]) => ({ id, name: t(name) })),
    enLater: t(EN_LATER),
    nodes: (Object.keys(NODES) as NodeId[]).map((id) => ({
      id,
      name: t(NODES[id].name),
      sign: t(NODES[id].sign),
      conds: NODES[id].conds,
      rules: rules.filter((r) => r.node === id).map((r) => r.id),
    })),
    sectors: (Object.keys(SECTORS) as Sector[]).map((id) => ({ id, name: t(SECTORS[id].name), conds: SECTORS[id].conds })),
    // Точки контроля — для «где проявилось» в «Причинах» (П-5.1: правила и точки — номером, тексты — здесь).
    points: (Object.keys(POINTS) as Point[]).map((id) => ({ id, name: t(POINTS[id].name) })),
    rules: rules.map((r) => {
      const { text, enLater } = ruleText(r, lang);
      return {
        id: r.id,
        group: r.group,
        zone: r.zone,
        score: score(r),
        v: r.v,
        c: r.c,
        conds: r.conds,
        ...(r.node !== undefined && { node: r.node }),
        ...(r.sector !== undefined && { sector: r.sector }),
        owner: t(PARTY_LABEL[r.owner]) + (r.owner2 !== undefined ? ", " + t(PARTY_LABEL[r.owner2]) : ""),
        kind: t(KIND_LABEL[r.kind]),
        control: t(CONTROL_LABEL[r.control]),
        coverage: t(COVERAGE_LABEL[r.coverage]),
        point: r.point,
        text,
        enLater,
      };
    }),
  };
}
export type RulesForPage = ReturnType<typeof rulesForPage>;

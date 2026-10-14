// Бренд банка — настройкой (инвариант 7, П1): название, цвета, логотип читаются из конфигурации, в коде литералом не пишутся.

export interface Brand {
  /** Название банка, как его видит человек. */
  name: string;
  colors: {
    primary: string;
    onPrimary: string;
    accent: string;
  };
  /** Путь или адрес логотипа. */
  logo: string;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Разбор конфигурации бренда. Неполная или неверная конфигурация — ошибка: интерфейс без бренда не стартует. */
export function parseBrand(raw: unknown): Brand {
  if (typeof raw !== "object" || raw === null) throw new Error("brand: ожидается объект");
  const r = raw as Record<string, unknown>;
  const name = r["name"];
  if (typeof name !== "string" || name.trim() === "") throw new Error("brand.name: пустое название");
  const logo = r["logo"];
  if (typeof logo !== "string" || logo.trim() === "") throw new Error("brand.logo: нет логотипа");
  const c = r["colors"];
  if (typeof c !== "object" || c === null) throw new Error("brand.colors: ожидается объект");
  const colors = c as Record<string, unknown>;
  const pick = (key: "primary" | "onPrimary" | "accent"): string => {
    const v = colors[key];
    if (typeof v !== "string" || !HEX.test(v)) throw new Error(`brand.colors.${key}: ожидается #RRGGBB`);
    return v;
  };
  return { name, logo, colors: { primary: pick("primary"), onPrimary: pick("onPrimary"), accent: pick("accent") } };
}

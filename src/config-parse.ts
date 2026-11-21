// Разбор файлов `config/` — общие примитивы (К3 П-К4, находка ревью К3 З6).
//
// Тексты и перечни приложения живут данными в `config/` (инвариант 7 и правило планов № 3), и разбирают их уже двое:
// профиль принципов (`src/principles/model.ts`, К1.2 П-К1) и тексты карточки поручения (`src/intent/texts.ts`, К3).
// Два разбора со своими сообщениями расходятся по строгости молча: один отвергает пустую строку, другой пропускает.
// Поэтому «что такое объект» и «что такое непустая строка» сказано здесь один раз; сообщения — те же, что были у
// разбора принципов, чтобы его тесты проверяли то же, что и раньше.

export function obj(raw: unknown, where: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${where}: ожидается объект`);
  return raw as Record<string, unknown>;
}

export function str(raw: Record<string, unknown>, key: string, where: string): string {
  const v = raw[key];
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${where}.${key}: пустая строка`);
  return v;
}

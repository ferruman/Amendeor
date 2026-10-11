// Модели заворачивают JSON в ```json … ``` даже при «Return JSON only»: снимаем одну внешнюю обёртку и разбираем.
export function parseModelJson(text: string): unknown {
  const fenced = text.trim().match(/^```[\w-]*\s*\n?([\s\S]*?)\n?```$/);
  return JSON.parse(fenced ? fenced[1] : text);
}

export function displayDate(value: string | Date): string {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function parseDate(value: string): Date {
  const match = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/.exec(
    value.trim(),
  );
  if (!match) throw new Error("Введите дату в формате ДД.ММ.ГГГГ ЧЧ:ММ.");
  const [, day, month, year, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (
    date.getDate() !== day ||
    date.getMonth() !== month - 1 ||
    date.getFullYear() !== year ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  )
    throw new Error("Проверьте дату и время.");
  return date;
}

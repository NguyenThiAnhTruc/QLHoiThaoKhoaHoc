export function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDateInput(value: string) {
  if (!value) return "";
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}${time ? ` ${time.slice(0, 5)}` : ""}`;
}

export function parseDateInput(value: string, withTime: boolean) {
  const match = value.trim().match(withTime
    ? /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/
    : /^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const [, day, month, year, hour = "00", minute = "00"] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59) return "";
  return `${year}-${month}-${day}${withTime ? `T${hour}:${minute}` : ""}`;
}

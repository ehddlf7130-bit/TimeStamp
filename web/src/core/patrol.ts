// Port of src/TimeStamp.Core/PatrolPlan.cs.
// All times are Korean wall-clock values. They are stored in a Date's UTC fields so the
// phone's own time zone (or DST) can never shift them.

export type Wall = Date;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export class PlanError extends Error {}

export interface PatrolPlan {
  start: Wall;
  end: Wall;
  slots: Wall[];
  count: number;
  minutes: number;
  outsideNormalHours: boolean;
}

/** Parse "YYYY-MM-DD" into a wall-clock midnight. */
export function parseDate(text: string): Wall {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) throw new PlanError('날짜를 선택해 주세요.');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const value = wall(y, mo, d);
  if (value.getUTCMonth() !== mo - 1 || value.getUTCDate() !== d) throw new PlanError('날짜를 선택해 주세요.');
  return value;
}

export function wall(y: number, mo: number, d: number, h = 0, mi = 0): Wall {
  const value = new Date(0);
  value.setUTCFullYear(y, mo - 1, d); // setUTCFullYear keeps years 0–99 literal
  value.setUTCHours(h, mi, 0, 0);
  return value;
}

export function addMinutes(value: Wall, minutes: number): Wall {
  return new Date(value.getTime() + minutes * MINUTE);
}

/** Strict 24-hour "HH:mm", like TimeOnly.TryParseExact. */
export function parseTime(text: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function createPlan(date: Wall, startText: string, endText: string): PatrolPlan {
  const year = date.getUTCFullYear();
  if (year < 1000 || year > 9998) throw new PlanError('시작 날짜는 1000년부터 9998년까지 입력해 주세요.');
  const start = parseTime(startText);
  const end = parseTime(endText);
  if (start === null || end === null) throw new PlanError('시간은 24시간 형식 HH:mm으로 입력해 주세요. 예: 20:00, 01:00');
  if (start === end) throw new PlanError('시작과 종료 시각은 서로 달라야 합니다.');
  const midnight = Math.floor(date.getTime() / DAY) * DAY;
  const from = new Date(midnight + start * MINUTE);
  let to = new Date(midnight + end * MINUTE);
  if (to < from) to = new Date(to.getTime() + DAY);
  const minutes = Math.round((to.getTime() - from.getTime()) / MINUTE);
  if (minutes % 5 !== 0) throw new PlanError('순찰 시간은 5분 단위여야 합니다. 종료 시각을 조정해 주세요.');
  const slots = Array.from({ length: minutes / 5 }, (_, i) => addMinutes(from, (i + 1) * 5));
  let outside = false;
  for (let i = 0; i <= minutes && !outside; i++) {
    const t = (start + i) % (24 * 60);
    outside = t > 60 && t < 20 * 60;
  }
  return { start: from, end: to, slots, count: slots.length, minutes, outsideNormalHours: outside };
}

/** One exact wall-clock minute, without the range plan's five-minute offset. */
export function createSinglePlan(date: Wall, timeText: string): PatrolPlan {
  const year = date.getUTCFullYear();
  if (year < 1000 || year > 9998) throw new PlanError('시작 날짜는 1000년부터 9998년까지 입력해 주세요.');
  const time = parseTime(timeText);
  if (time === null) throw new PlanError('시간은 24시간 형식 HH:mm으로 입력해 주세요. 예: 23:17');
  const at = new Date(Math.floor(date.getTime() / DAY) * DAY + time * MINUTE);
  return { start: at, end: at, slots: [at], count: 1, minutes: 0, outsideNormalHours: time > 60 && time < 20 * 60 };
}

const WEEKDAYS = '일월화수목금토';

export function stampDate(v: Wall): string {
  return `${v.getUTCFullYear()}년 ${v.getUTCMonth() + 1}월 ${v.getUTCDate()}일 (${WEEKDAYS[v.getUTCDay()]})`;
}

export function stampTime(v: Wall): string {
  const h = v.getUTCHours();
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** "20261109_2335" — the export file-name time part. */
export function fileStamp(v: Wall): string {
  return `${pad(v.getUTCFullYear(), 4)}${pad(v.getUTCMonth() + 1)}${pad(v.getUTCDate())}_${pad(v.getUTCHours())}${pad(v.getUTCMinutes())}`;
}

export function hhmm(v: Wall): string {
  return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
}

export function isoDate(v: Wall): string {
  return `${pad(v.getUTCFullYear(), 4)}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
}

/** Today's date in Korea, whatever the phone's time zone. */
export function koreaToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Next unfilled planned slot, wrapping once. `count` means all slots are filled. */
export function nextPendingSlot(count: number, completed: Iterable<number>, from = 0): number {
  const taken = new Set(completed);
  const start = Number.isInteger(from) && from >= 0 && from < count ? from : 0;
  for (let offset = 0; offset < count; offset++) {
    const index = (start + offset) % count;
    if (!taken.has(index)) return index;
  }
  return count;
}

export function exportFileName(index: number, time: Wall): string {
  return `${pad(index + 1, 3)}_${fileStamp(time)}${pad(time.getUTCSeconds())}.jpg`;
}

/** Batch exports use the planned minute and the selected image format. */
export function exportName(index: number, time: Wall, png: boolean): string {
  return `${pad(index + 1, 3)}_${fileStamp(time)}.${png ? 'png' : 'jpg'}`;
}

/** Place every photo at most once; surplus photos remain in the library. */
export function arrange(slotCount: number, photoCount: number, random: boolean, rng = Math.random): (number | null)[] {
  const photos = Array.from({ length: photoCount }, (_, i) => i);
  const slots = Array.from({ length: slotCount }, (_, i) => i);
  const shuffle = (values: number[]) => {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
  };
  if (random) { shuffle(photos); shuffle(slots); }
  const result: (number | null)[] = Array(slotCount).fill(null);
  for (let i = 0; i < Math.min(slotCount, photoCount); i++) result[slots[i]] = photos[i];
  return result;
}

/** Move a photo, swapping with an occupied target without duplicating it. */
export function assign<T>(slots: (T | null)[], target: number, photo: T): void {
  if (target < 0 || target >= slots.length) throw new RangeError('target');
  const previous = slots.indexOf(photo);
  if (previous === target) return;
  if (previous >= 0) slots[previous] = slots[target];
  slots[target] = photo;
}

/** Validate the whole selection before replacing anything; a single pair keeps swap semantics. */
export function assignMany<T>(slots: (T | null)[], targets: number[], photos: T[]): (T | null)[] {
  if (!targets.length || targets.length !== photos.length) throw new PlanError('선택한 사진과 시간의 개수를 맞춰 주세요.');
  if (new Set(targets).size !== targets.length || new Set(photos).size !== photos.length || photos.some((p) => p === null)) throw new PlanError('사진과 시간은 중복 없이 선택해 주세요.');
  if (targets.some((i) => !Number.isInteger(i) || i < 0 || i >= slots.length)) throw new RangeError('target');
  const result = [...slots];
  if (targets.length === 1) assign(result, targets[0], photos[0]);
  else {
    const moving = new Set(photos);
    result.forEach((p, i) => { if (p !== null && moving.has(p)) result[i] = null; });
    targets.forEach((target, i) => { result[target] = photos[i]; });
  }
  return result;
}

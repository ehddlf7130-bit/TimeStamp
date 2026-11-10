// Port of tests/TimeStamp.Checks/Program.cs.
import { describe, expect, it } from 'vitest';
import { addMinutes, arrange, assign, createPlan, exportName, exportFileName, floorMinute, hhmm, isoDate, koreaNow, koreaToday, matchSlot, PlanError, SLOT_WINDOW_MS, stampDate, stampTime, wall } from '../src/core/patrol';

const date = wall(2026, 11, 9);
const minutes = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

describe('PatrolPlan', () => {
  const hour = createPlan(date, '00:00', '01:00');
  const night = createPlan(date, '20:00', '01:00');

  it('00:00–01:00 = 12 photos', () => { expect(hour.count).toBe(12); expect(hour.minutes).toBe(60); });
  it('first +5, final exactly end', () => {
    expect(hour.slots[0]).toEqual(addMinutes(date, 5));
    expect(hour.slots.at(-1)).toEqual(addMinutes(date, 60));
  });
  it('departure excluded', () => expect(hour.slots.some((s) => s.getTime() === hour.start.getTime())).toBe(false));
  it('every interval exactly five minutes', () => {
    for (let i = 1; i < hour.count; i++) expect(minutes(hour.slots[i - 1], hour.slots[i])).toBe(5);
  });
  it('first half quick preset', () => expect(createPlan(date, '00:00', '00:30').count).toBe(6));
  it('second half quick preset', () => {
    const half = createPlan(date, '00:30', '01:00');
    expect(half.count).toBe(6); expect(hhmm(half.slots[0])).toBe('00:35');
  });
  it('overnight = 60 photos, date rollover', () => {
    expect(night.count).toBe(60);
    expect(night.end).toEqual(wall(2026, 11, 10, 1, 0));
  });
  it('midnight photo dated next day', () => {
    const m = night.slots.filter((s) => s.getUTCHours() === 0 && s.getUTCMinutes() === 0);
    expect(m).toHaveLength(1); expect(isoDate(m[0])).toBe('2026-11-10');
  });
  it('normal time boundaries accepted', () => { expect(night.outsideNormalHours).toBe(false); expect(hour.outsideNormalHours).toBe(false); });
  it('early departure warning', () => expect(createPlan(date, '19:55', '20:00').outsideNormalHours).toBe(true));
  it('late finish warning', () => expect(createPlan(date, '01:00', '01:05').outsideNormalHours).toBe(true));
  it('daylight crossing warning even if endpoints normal', () => expect(createPlan(date, '00:30', '20:30').outsideNormalHours).toBe(true));
  it('relative five-minute intervals', () => expect(createPlan(date, '20:01', '20:31').count).toBe(6));
  it('five-minute midnight patrol', () => expect(createPlan(date, '23:55', '00:00').count).toBe(1));
  it('leap-year rollover', () => expect(isoDate(createPlan(wall(2028, 2, 28), '23:55', '00:05').end)).toBe('2028-02-29'));
  it('year rollover', () => expect(createPlan(wall(2026, 12, 31), '23:55', '00:05').end.getUTCFullYear()).toBe(2027));
  it('year range', () => {
    expect(() => createPlan(wall(999, 1, 1), '00:00', '00:05')).toThrow(PlanError);
    expect(() => createPlan(wall(9999, 1, 1), '00:00', '00:05')).toThrow(PlanError);
    expect(createPlan(wall(9998, 12, 31), '23:55', '00:00').count).toBe(1);
  });
  it('equal endpoints rejected', () => expect(() => createPlan(date, '00:00', '00:00')).toThrow(PlanError));
  it('partial interval rejected', () => expect(() => createPlan(date, '00:00', '00:32')).toThrow('5분 단위'));
  for (const invalid of ['24:00', '12:60', '-1:00', 'x', '8:00', ''])
    it('invalid time: ' + JSON.stringify(invalid), () => expect(() => createPlan(date, invalid, '01:00')).toThrow(PlanError));
});

describe('StampText', () => {
  it('Korean date, weekday and unpadded day', () => expect(stampDate(date)).toBe('2026년 11월 9일 (월)'));
  it('single digit date', () => expect(stampDate(wall(2027, 3, 3))).toBe('2027년 3월 3일 (수)'));
  it('midnight formatting', () => expect(stampTime(date)).toBe('오전 12:00'));
  it('noon formatting', () => expect(stampTime(wall(2026, 11, 9, 12, 34))).toBe('오후 12:34'));
  it('PM formatting', () => expect(stampTime(wall(2026, 11, 9, 23, 49))).toBe('오후 11:49'));
  it('export file name', () => expect(exportName(0, wall(2026, 11, 9, 23, 35), false)).toBe('001_20261109_2335.jpg'));
  it('PNG export file name', () => expect(exportName(5, wall(2026, 11, 10, 0, 5), true)).toBe('006_20261110_0005.png'));
  it('Korea today ignores device time zone', () => expect(koreaToday(new Date('2026-11-09T16:00:00Z'))).toBe('2026-11-10'));
});

describe('live patrol time', () => {
  const plan = createPlan(date, '20:00', '20:30');
  it('uses the current Korean wall clock across midnight', () => {
    expect(koreaNow(new Date('2026-11-09T15:05:12.345Z')).toISOString()).toBe('2026-11-10T00:05:12.345Z');
  });
  it('truncates the visible stamp to the minute without changing the recorded instant', () => {
    const time = koreaNow(new Date('2026-11-09T11:05:12.345Z'));
    expect(floorMinute(time)).toEqual(wall(2026, 11, 9, 20, 5));
    expect(exportFileName(1, time)).toBe('002_20261109_200512.jpg');
    expect(time.getUTCMilliseconds()).toBe(345);
  });
  it('confirms the nearest slot', () => {
    expect(matchSlot(plan, wall(2026, 11, 9, 20, 4))).toBe(0);
    expect(matchSlot(plan, wall(2026, 11, 9, 20, 11))).toBe(1);
  });
  it('assigns an internal midpoint to the later slot', () => {
    expect(matchSlot(plan, new Date(plan.slots[0].getTime() + SLOT_WINDOW_MS))).toBe(1);
  });
  it('accepts both outer window boundaries', () => {
    expect(matchSlot(plan, new Date(plan.slots[0].getTime() - SLOT_WINDOW_MS))).toBe(0);
    expect(matchSlot(plan, new Date(plan.end.getTime() + SLOT_WINDOW_MS))).toBe(5);
  });
  it('rejects photos outside the patrol window', () => {
    expect(matchSlot(plan, new Date(plan.slots[0].getTime() - SLOT_WINDOW_MS - 1))).toBe(-1);
    expect(matchSlot(plan, new Date(plan.end.getTime() + SLOT_WINDOW_MS + 1))).toBe(-1);
  });
  it('matches slots after midnight', () => {
    const night = createPlan(date, '23:55', '00:10');
    expect(matchSlot(night, wall(2026, 11, 10, 0, 5))).toBe(1);
  });
});

describe('PhotoPlacement', () => {
  let seed = 42;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  it('sequential placement, excess waiting', () => expect(arrange(3, 5, false)).toEqual([0, 1, 2]));
  it('random placement without duplicates', () => {
    const fewer = arrange(12, 4, true, rng).filter((x) => x !== null);
    expect(fewer).toHaveLength(4); expect(new Set(fewer).size).toBe(4);
  });
  it('random subset for excess photos', () => {
    const more = arrange(5, 12, true, rng);
    expect(more.every((x) => x !== null)).toBe(true); expect(new Set(more).size).toBe(5);
  });
  it('empty library', () => expect(arrange(4, 0, true).some((x) => x !== null)).toBe(false));
  it('manual assignment', () => {
    const a = {}, b = {}, c = {};
    const p: ({} | null)[] = [a, b, null];
    assign(p, 1, a); expect(p[0]).toBe(b); expect(p[1]).toBe(a);           // swaps occupied slots
    assign(p, 2, a); expect(p[1]).toBe(null); expect(p[2]).toBe(a);        // move frees prior slot
    assign(p, 0, c); expect(p[0]).toBe(c); expect(p[2]).toBe(a);           // unassigned replaces target only
    assign(p, 0, c); expect(p.filter((x) => x === c)).toHaveLength(1);    // idempotent
  });
});

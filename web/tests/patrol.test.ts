// Port of tests/TimeStamp.Checks/Program.cs.
import { describe, expect, it } from 'vitest';
import { addMinutes, arrange, assign, assignMany, createPlan, createSinglePlan, exportName, hhmm, isoDate, koreaToday, nextPendingSlot, PlanError, stampDate, stampTime, wall } from '../src/core/patrol';
import { planFrom } from '../src/pages/planform';

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

describe('single-time plans and stored session compatibility', () => {
  it('uses exactly 23:17 on the selected date without adding five minutes', () => {
    const plan = createSinglePlan(wall(2026, 11, 11), '23:17');
    expect(plan.count).toBe(1); expect(plan.minutes).toBe(0);
    expect(plan.slots).toEqual([wall(2026, 11, 11, 23, 17)]);
    expect(plan.start).toEqual(plan.end);
    expect(nextPendingSlot(plan.count, [0])).toBe(1);
  });
  it('does not parse the unused end time in single mode', () => {
    expect(planFrom({ date: '2026-11-11', start: '00:00', end: '', mode: 'single' }).slots).toEqual([wall(2026, 11, 11)]);
  });
  it('keeps old sessions without a mode as five-minute range plans', () => {
    expect(planFrom({ date: '2026-11-11', start: '23:00', end: '23:30' }).slots.map(hhmm))
      .toEqual(['23:05', '23:10', '23:15', '23:20', '23:25', '23:30']);
  });
  it('validates the date and exact minute', () => {
    expect(() => planFrom({ date: '2026-02-30', start: '23:17', end: '', mode: 'single' })).toThrow(PlanError);
    expect(() => createSinglePlan(date, '24:00')).toThrow(PlanError);
    expect(() => createSinglePlan(wall(9999, 1, 1), '23:17')).toThrow(PlanError);
    expect(createSinglePlan(date, '12:17').outsideNormalHours).toBe(true);
    expect(createSinglePlan(date, '00:17').outsideNormalHours).toBe(false);
  });
});

describe('multi-photo placement', () => {
  it('places ordered pairs in one operation without changing other slots', () => {
    const original = ['A', 'B', 'C', 'D', null];
    expect(assignMany(original, [2, 4], ['A', 'B'])).toEqual([null, null, 'A', 'D', 'B']);
    expect(original).toEqual(['A', 'B', 'C', 'D', null]);
  });
  it('moves cycles simultaneously without duplicating any selected photo', () => {
    expect(assignMany(['A', 'B', 'C'], [0, 1, 2], ['C', 'A', 'B'])).toEqual(['C', 'A', 'B']);
    expect(assignMany(['A', 'B', 'C', 'D'], [1, 3], ['A', 'C'])).toEqual([null, 'A', null, 'C']);
  });
  it('preserves the existing swap rule for one photo and one time', () => {
    expect(assignMany(['A', 'B', null], [1], ['A'])).toEqual(['B', 'A', null]);
  });
  it('rejects mismatched counts atomically', () => {
    const original = ['A', 'B', 'C'];
    expect(() => assignMany(original, [0, 1], ['C'])).toThrow('개수를 맞춰');
    expect(original).toEqual(['A', 'B', 'C']);
  });
  it('rejects empty, duplicate, or invalid selections before modifying slots', () => {
    const original = ['A', 'B', 'C'];
    for (const [targets, photos] of [[[], []], [[0, 0], ['A', 'B']], [[0, 1], ['A', 'A']], [[0, 9], ['A', 'B']]] as [number[], string[]][]) {
      expect(() => assignMany(original, targets, photos)).toThrow();
      expect(original).toEqual(['A', 'B', 'C']);
    }
  });
});

describe('planned patrol capture', () => {
  it('23:00–23:30 produces exactly the six requested stamp times', () => {
    const plan = createPlan(date, '23:00', '23:30');
    expect(plan.slots.map(hhmm)).toEqual(['23:05', '23:10', '23:15', '23:20', '23:25', '23:30']);
  });
  it('starts at the first slot and advances after each saved shot', () => {
    const filled = new Set<number>();
    for (let i = 0; i < 6; i++) {
      expect(nextPendingSlot(6, filled, i)).toBe(i);
      filled.add(i);
      expect(nextPendingSlot(6, filled, i)).toBe(i + 1);
    }
  });
  it('retaking an earlier photo preserves the next pending slot', () => {
    expect(nextPendingSlot(6, [0, 1, 2], 3)).toBe(3);
    expect(nextPendingSlot(6, [0, 1, 2, 0], 3)).toBe(3);
  });
  it('recovers an unfilled slot after deleting a completed photo', () => {
    expect(nextPendingSlot(6, [0, 1, 3, 4, 5], 6)).toBe(2);
  });
  it('wraps to any earlier hole and skips already filled slots', () => {
    expect(nextPendingSlot(6, [1, 2, 3, 4, 5], 5)).toBe(0);
  });
  it('returns the completion marker without generating a seventh slot', () => {
    expect(nextPendingSlot(6, [0, 1, 2, 3, 4, 5])).toBe(6);
  });
  it('restores the first unfilled slot when an old session has no cursor', () => {
    expect(nextPendingSlot(6, [0, 1], undefined)).toBe(2);
  });
  it('uses the next date when the planned sequence crosses midnight', () => {
    const plan = createPlan(date, '23:50', '00:10');
    expect(plan.slots.map((t, i) => exportName(i, t, false))).toEqual([
      '001_20261109_2355.jpg', '002_20261110_0000.jpg', '003_20261110_0005.jpg', '004_20261110_0010.jpg',
    ]);
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

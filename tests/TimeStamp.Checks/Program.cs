using TimeStamp.Core;

var passed = 0;
void Check(bool condition, string description)
{
    if (!condition) throw new Exception("FAIL: " + description);
    Console.WriteLine("PASS: " + description); passed++;
}
void Reject(Action action, string description)
{
    try { action(); } catch (ArgumentException) { Check(true, description); return; }
    throw new Exception("FAIL (accepted invalid input): " + description);
}
var date = new DateTime(2026, 11, 9);
var hour = PatrolPlan.Create(date, "00:00", "01:00");
Check(hour.Count == 12 && hour.Minutes == 60, "00:00–01:00 = 12 photos");
Check(hour.Slots[0] == date.AddMinutes(5) && hour.Slots[^1] == date.AddHours(1), "first +5, final exactly end");
Check(!hour.Slots.Contains(hour.Start), "departure excluded");
Check(Enumerable.Range(1, hour.Count - 1).All(i => hour.Slots[i] - hour.Slots[i-1] == TimeSpan.FromMinutes(5)), "every interval exactly five minutes");
Check(PatrolPlan.Create(date, "00:00", "00:30").Count == 6, "first half quick preset");
var half = PatrolPlan.Create(date, "00:30", "01:00");
Check(half.Count == 6 && half.Slots[0].ToString("HH:mm") == "00:35", "second half quick preset");
var night = PatrolPlan.Create(date, "20:00", "01:00");
Check(night.Count == 60 && night.End == date.AddDays(1).AddHours(1), "overnight = 60 photos, date rollover");
Check(night.Slots.Single(x => x.Hour == 0 && x.Minute == 0).Date == date.AddDays(1), "midnight photo dated next day");
Check(!night.OutsideNormalHours && !hour.OutsideNormalHours, "normal time boundaries accepted");
Check(PatrolPlan.Create(date, "19:55", "20:00").OutsideNormalHours, "early departure warning");
Check(PatrolPlan.Create(date, "01:00", "01:05").OutsideNormalHours, "late finish warning");
Check(PatrolPlan.Create(date, "00:30", "20:30").OutsideNormalHours, "daylight crossing warning even if endpoints normal");
Check(PatrolPlan.Create(date, "20:01", "20:31").Count == 6, "relative five-minute intervals");
Check(PatrolPlan.Create(date, "23:55", "00:00").Count == 1, "five-minute midnight patrol");
Check(PatrolPlan.Create(new(2028, 2, 28), "23:55", "00:05").End.Date == new DateTime(2028,2,29), "leap-year rollover");
Check(PatrolPlan.Create(new(2026,12,31), "23:55", "00:05").End.Year == 2027, "year rollover");
Reject(() => PatrolPlan.Create(date, "00:00", "00:00"), "equal endpoints rejected");
Reject(() => PatrolPlan.Create(date, "00:00", "00:32"), "partial interval rejected");
foreach (var invalid in new[] { "24:00", "12:60", "-1:00", "x", "8:00", "" })
    Reject(() => PatrolPlan.Create(date, invalid, "01:00"), "invalid time: " + invalid);
Check(StampText.Date(date) == "2026년 11월 9일 (월)", "Korean date, weekday and unpadded day");
Check(StampText.Date(new(2027,3,3)) == "2027년 3월 3일 (수)", "single digit date");
Check(StampText.Time(date) == "오전 12:00", "midnight formatting");
Check(StampText.Time(date.AddHours(12).AddMinutes(34)) == "오후 12:34", "noon formatting");
Check(StampText.Time(date.AddHours(23).AddMinutes(49)) == "오후 11:49", "PM formatting");
var sequence = PhotoPlacement.Arrange(3, 5, false);
Check(sequence.SequenceEqual(new int?[] {0,1,2}), "sequential placement, excess waiting");
var fewer = PhotoPlacement.Arrange(12, 4, true, new Random(42));
Check(fewer.Count(x => x != null) == 4 && fewer.Where(x => x != null).Distinct().Count() == 4, "random placement without duplicates");
var more = PhotoPlacement.Arrange(5, 12, true, new Random(9));
Check(more.All(x => x != null) && more.Distinct().Count() == 5, "random subset for excess photos");
Check(!PhotoPlacement.Arrange(4, 0, true).Any(x=>x != null), "empty library");
var a = new object(); var b = new object(); var c = new object();
var placement = new List<object?> { a, b, null };
PhotoPlacement.Assign(placement, 1, a);
Check(ReferenceEquals(placement[0],b) && ReferenceEquals(placement[1],a), "manual assignment swaps occupied slots");
PhotoPlacement.Assign(placement, 2, a);
Check(placement[1] == null && ReferenceEquals(placement[2],a), "manual move frees prior slot");
PhotoPlacement.Assign(placement, 0, c);
Check(ReferenceEquals(placement[0],c) && ReferenceEquals(placement[2],a), "unassigned photo replaces target only");
PhotoPlacement.Assign(placement, 0, c);
Check(placement.Count(x=>ReferenceEquals(x,c)) == 1, "self assignment idempotent");
Console.WriteLine($"\n{passed} checks passed.");

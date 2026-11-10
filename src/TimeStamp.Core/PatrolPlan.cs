using System.Globalization;

namespace TimeStamp.Core;

/// <summary>입력 날짜는 순찰 시작일. 모든 시각은 한국 현지 벽시계 시각이다.</summary>
public sealed record PatrolPlan(DateTime Start, DateTime End, IReadOnlyList<DateTime> Slots)
{
    public int Count => Slots.Count;
    public int Minutes => (int)(End - Start).TotalMinutes;
    public bool OutsideNormalHours => Enumerable.Range(0, Minutes + 1)
        .Select(i => Start.AddMinutes(i).TimeOfDay)
        .Any(t => t > TimeSpan.FromHours(1) && t < TimeSpan.FromHours(20));

    public static PatrolPlan Create(DateTime date, string startText, string endText)
    {
        if (date.Year is < 1000 or > 9998)
            throw new ArgumentException("시작 날짜는 1000년부터 9998년까지 입력해 주세요.");
        if (!TimeOnly.TryParseExact(startText, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var start)
            || !TimeOnly.TryParseExact(endText, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var end))
            throw new ArgumentException("시간은 24시간 형식 HH:mm으로 입력해 주세요. 예: 20:00, 01:00");
        if (start == end) throw new ArgumentException("시작과 종료 시각은 서로 달라야 합니다.");
        var from = date.Date.Add(start.ToTimeSpan());
        var to = date.Date.Add(end.ToTimeSpan());
        if (to < from) to = to.AddDays(1);
        var minutes = (int)(to - from).TotalMinutes;
        if (minutes % 5 != 0)
            throw new ArgumentException("순찰 시간은 5분 단위여야 합니다. 종료 시각을 조정해 주세요.");
        var slots = Enumerable.Range(1, minutes / 5).Select(i => from.AddMinutes(i * 5)).ToArray();
        return new(from, to, slots);
    }
}

public static class StampText
{
    public static string Date(DateTime value) => $"{value.Year}년 {value.Month}월 {value.Day}일 ({"일월화수목금토"[(int)value.DayOfWeek]})";
    public static string Time(DateTime value) => $"{(value.Hour < 12 ? "오전" : "오후")} {(value.Hour % 12 == 0 ? 12 : value.Hour % 12)}:{value.Minute:00}";
}

public static class PhotoPlacement
{
    /// <summary>사진 한 장당 슬롯 하나. 기존 배치를 대체하며, 초과 사진은 대기한다.</summary>
    public static int?[] Arrange(int slotCount, int photoCount, bool random, Random? source = null)
    {
        if (slotCount < 0 || photoCount < 0) throw new ArgumentOutOfRangeException();
        var slots = new int?[slotCount];
        var photos = Enumerable.Range(0, photoCount).ToArray();
        var positions = Enumerable.Range(0, slotCount).ToArray();
        if (random)
        {
            var rng = source ?? Random.Shared;
            rng.Shuffle(photos);
            rng.Shuffle(positions);
        }
        for (var i = 0; i < Math.Min(slotCount, photoCount); i++) slots[positions[i]] = photos[i];
        return slots;
    }

    /// <summary>이미 배치한 사진을 다른 슬롯에 지정하면 두 슬롯의 사진을 교환한다.</summary>
    public static void Assign<T>(IList<T?> slots, int target, T photo) where T : class
    {
        if (target < 0 || target >= slots.Count) throw new ArgumentOutOfRangeException(nameof(target));
        var previous = -1;
        for (var i = 0; i < slots.Count; i++) if (ReferenceEquals(slots[i], photo)) { previous = i; break; }
        if (previous == target) return;
        if (previous >= 0) slots[previous] = slots[target];
        slots[target] = photo;
    }
}

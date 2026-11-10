using Microsoft.Win32;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.IO.Compression;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using TimeStamp.Core;

namespace TimeStamp.App;

public sealed record Photo(string Path, string Name, int Size, BitmapSource Thumbnail)
{
    public string SizeText => $"{Size} × {Size}";
}

public sealed class Slot(DateTime time) : INotifyPropertyChanged
{
    public DateTime Time { get; } = time;
    public string TimeText => Time.ToString("HH:mm");
    public string DayText => Time.ToString("MM.dd");
    private Photo? photo;
    public Photo? Photo { get => photo; set { photo = value; PropertyChanged?.Invoke(this, new(nameof(PhotoName))); } }
    public string PhotoName => Photo?.Name ?? "비어 있음";
    public event PropertyChangedEventHandler? PropertyChanged;
}

public partial class MainWindow : Window
{
    private readonly ObservableCollection<Photo> photos = new();
    private readonly ObservableCollection<Slot> slots = new();
    private readonly StampRenderer renderer;
    private PatrolPlan? calculatorPlan;
    private PatrolPlan? stampPlan;
    private bool busy;

    public MainWindow()
    {
        InitializeComponent();
        renderer = new StampRenderer();
        var korea = TimeZoneInfo.FindSystemTimeZoneById("Korea Standard Time");
        CalcDate.SelectedDate = StampDate.SelectedDate = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, korea).Date;
        PhotoList.ItemsSource = photos;
        SlotList.ItemsSource = slots;
        CalculatePlan(false);
        SetStampPlan(PatrolPlan.Create(StampDate.SelectedDate.Value, StampStart.Text, StampEnd.Text));
        Closing += (_, e) => { if (busy) { e.Cancel = true; Status("작업이 끝난 뒤 창을 닫아 주세요."); } };
    }

    private void Status(string value) => StatusText.Text = value;
    private void Alert(string message, MessageBoxImage image = MessageBoxImage.Warning) => MessageBox.Show(this, message, "타임스탬프", MessageBoxButton.OK, image);
    private void ShowCalculator(object sender, RoutedEventArgs e) => Navigate(false);
    private void ShowStamp(object sender, RoutedEventArgs e) => Navigate(true);
    internal void Navigate(bool stamp)
    {
        CalculatorPage.Visibility = stamp ? Visibility.Collapsed : Visibility.Visible;
        StampPage.Visibility = stamp ? Visibility.Visible : Visibility.Collapsed;
        PageEyebrow.Text = stamp ? "PHOTO STAMP STUDIO" : "PATROL PLANNER";
        PageTitle.Text = stamp ? "스탬프 찍기" : "순찰 계산기";
        PageDescription.Text = stamp ? "사진을 원하는 시간에 배치하고, 스탬프가 찍힌 사진으로 저장하세요." : "순찰 시간을 정하면, 필요한 사진 수와 촬영 시각을 계산해 드려요.";
        CalcNav.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(stamp ? "#152D36" : "#284750"));
        StampNav.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(stamp ? "#284750" : "#152D36"));
    }

    private static PatrolPlan ReadPlan(DatePicker date, TextBox start, TextBox end)
    {
        if (date.SelectedDate is not DateTime selected) throw new ArgumentException("올바른 순찰 시작 날짜를 선택해 주세요.");
        return PatrolPlan.Create(selected, start.Text.Trim(), end.Text.Trim());
    }

    internal bool CalculatePlan(bool showWarning)
    {
        try
        {
            calculatorPlan = ReadPlan(CalcDate, CalcStart, CalcEnd);
            CountText.Text = calculatorPlan.Count.ToString();
            DurationText.Text = $"총 {calculatorPlan.Minutes}분 순찰 · 5분마다 1장";
            RuleText.Text = $"{calculatorPlan.Start:HH:mm}에 출발하면 첫 사진은 {calculatorPlan.Slots[0]:HH:mm}, 마지막 사진은 {calculatorPlan.End:HH:mm}입니다. 시작 시각에는 사진을 세지 않아요.";
            FirstText.Text = calculatorPlan.Slots[0].ToString("HH:mm");
            LastText.Text = calculatorPlan.End.ToString("HH:mm") + (calculatorPlan.End.Date > calculatorPlan.Start.Date ? " +1일" : "");
            Timeline.ItemsSource = calculatorPlan.Slots.Select(t => t.ToString("HH:mm") + (t.Date > calculatorPlan.Start.Date ? " (+1일)" : ""));
            CalcWarning.Text = "⚠ 일반 순찰 시간(20:00~다음 날 01:00)을 벗어납니다. 입력한 시간이 맞는지 확인해 주세요.";
            CalcWarning.Visibility = calculatorPlan.OutsideNormalHours ? Visibility.Visible : Visibility.Collapsed;
            if (showWarning && calculatorPlan.OutsideNormalHours) Alert(CalcWarning.Text);
            Status($"계산 완료 · 사진 {calculatorPlan.Count}장이 필요합니다.");
            return true;
        }
        catch (ArgumentException ex)
        {
            calculatorPlan = null;
            CountText.Text = "—"; DurationText.Text = "시간을 확인해 주세요";
            FirstText.Text = LastText.Text = "—"; Timeline.ItemsSource = null; RuleText.Text = ex.Message;
            CalcWarning.Text = ex.Message; CalcWarning.Visibility = Visibility.Visible;
            if (showWarning) Alert(ex.Message);
            return false;
        }
    }
    private void Calculate(object sender, RoutedEventArgs e) => CalculatePlan(true);
    private void QuickCalculate(object sender, RoutedEventArgs e)
    {
        var values = ((string)((Button)sender).Tag).Split('|');
        CalcStart.Text = values[0]; CalcEnd.Text = values[1]; CalculatePlan(true);
    }

    private void ContinueToStamp(object sender, RoutedEventArgs e)
    {
        if (AutoFill.IsChecked == true)
        {
            if (!CalculatePlan(true)) return;
            StampDate.SelectedDate = calculatorPlan!.Start.Date;
            StampStart.Text = calculatorPlan.Start.ToString("HH:mm"); StampEnd.Text = calculatorPlan.End.ToString("HH:mm");
            SetStampPlan(calculatorPlan);
        }
        Navigate(true);
    }

    private void ApplyStampTime(object sender, RoutedEventArgs e)
    {
        try
        {
            var plan = ReadPlan(StampDate, StampStart, StampEnd);
            if (plan.OutsideNormalHours) Alert("일반 순찰 시간(20:00~다음 날 01:00)을 벗어납니다. 입력한 시간으로 적용합니다.");
            SetStampPlan(plan);
            Status("시간 적용 완료 · 사진을 불러와 원하는 시간에 배치하세요.");
        }
        catch (ArgumentException ex) { Alert(ex.Message); }
    }

    internal void SetStampPlan(PatrolPlan plan)
    {
        if (stampPlan?.Start == plan.Start && stampPlan?.End == plan.End) return;
        // Keep assignments by exact date and time, leave all other photos in the library.
        var old = slots.ToDictionary(s => s.Time, s => s.Photo);
        stampPlan = plan;
        slots.Clear();
        foreach (var t in plan.Slots) slots.Add(new(t) { Photo = old.GetValueOrDefault(t) });
        StampPlanSummary.Text = $"{plan.Start:yyyy.MM.dd HH:mm} → {plan.End:yyyy.MM.dd HH:mm} · {plan.Count}장" + (plan.OutsideNormalHours ? " · ⚠ 일반 순찰 시간 밖" : "");
        SlotList.SelectedIndex = 0;
        UpdateCounts(); UpdatePreview();
    }

    private async void ImportPhotos(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Title = "정사각형 사진 선택 (여러 장 선택 가능)", Multiselect = true, Filter = "사진|*.jpg;*.jpeg;*.png;*.bmp;*.tif;*.tiff|모든 파일|*.*" };
        if (dialog.ShowDialog(this) == true) await LoadPhotos(dialog.FileNames);
    }
    private void FilesDragOver(object sender, DragEventArgs e) { e.Effects = !busy && e.Data.GetDataPresent(DataFormats.FileDrop) ? DragDropEffects.Copy : DragDropEffects.None; e.Handled = true; }
    private async void FilesDropped(object sender, DragEventArgs e)
    {
        if (!busy && e.Data.GetData(DataFormats.FileDrop) is string[] paths) await LoadPhotos(paths);
    }
    internal async Task LoadPhotos(IEnumerable<string> paths)
    {
        if (busy) return;
        SetBusy(true);
        var rejected = new List<string>(); var added = 0; var duplicate = 0;
        try
        {
            foreach (var path in paths)
            {
                if (photos.Any(p => string.Equals(p.Path, System.IO.Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase))) { duplicate++; continue; }
                try
                {
                    var photo = await Task.Run(() =>
                    {
                        var size = ImageLoader.Dimensions(path); ImageLoader.RequireSquare(size.Width, size.Height);
                        var thumbnail = ImageLoader.Load(path, Math.Min(180, size.Width));
                        return new Photo(System.IO.Path.GetFullPath(path), System.IO.Path.GetFileName(path), size.Width, thumbnail);
                    });
                    photos.Add(photo); added++;
                }
                catch (Exception ex) when (ex is not OutOfMemoryException)
                { rejected.Add($"{System.IO.Path.GetFileName(path)}: {ex.Message}"); }
                Status($"사진 불러오는 중 · {added}장 추가됨");
            }
            UpdateCounts(); if (PhotoList.SelectedIndex < 0 && photos.Count > 0) PhotoList.SelectedIndex = 0;
            Status($"사진 {added}장 추가 · 중복 {duplicate}장 건너뜀 · 제외 {rejected.Count}장");
            if (rejected.Count > 0) Alert("다음 사진은 추가하지 않았습니다.\n\n" + string.Join("\n", rejected.Take(12)) + (rejected.Count > 12 ? $"\n외 {rejected.Count - 12}장" : ""));
        }
        finally { SetBusy(false); }
    }

    private void RemovePhoto(object sender, RoutedEventArgs e)
    {
        if (PhotoList.SelectedItem is not Photo photo) return;
        foreach (var slot in slots.Where(s => s.Photo == photo)) slot.Photo = null;
        photos.Remove(photo); UpdateCounts(); UpdatePreview();
    }
    private void ArrangeSequential(object sender, RoutedEventArgs e) => Arrange(false);
    private void ArrangeRandom(object sender, RoutedEventArgs e) => Arrange(true);
    internal void Arrange(bool random)
    {
        if (photos.Count == 0) { Status("먼저 사진을 불러와 주세요."); return; }
        var arrangement = PhotoPlacement.Arrange(slots.Count, photos.Count, random);
        for (var i = 0; i < slots.Count; i++) slots[i].Photo = arrangement[i] is int p ? photos[p] : null;
        UpdateCounts(); UpdatePreview();
        Status((random ? "랜덤 배치 완료" : "순서대로 배치 완료") + " · 사진을 선택하고 원하는 시간을 골라 수동으로 바꿀 수 있습니다.");
    }
    internal void AssignPhoto(object sender, RoutedEventArgs e)
    {
        if (PhotoList.SelectedItem is not Photo photo || SlotList.SelectedIndex < 0) { Status("왼쪽 사진과 가운데 시간을 각각 선택해 주세요."); return; }
        var placement = slots.Select(s => s.Photo).ToList();
        PhotoPlacement.Assign(placement, SlotList.SelectedIndex, photo);
        for (var i = 0; i < slots.Count; i++) slots[i].Photo = placement[i];
        UpdateCounts(); UpdatePreview();
        Status($"{((Slot)SlotList.SelectedItem).Time:HH:mm}에 {photo.Name} 배치 완료");
    }
    private void ClearSlot(object sender, RoutedEventArgs e)
    {
        if (SlotList.SelectedItem is Slot slot) slot.Photo = null;
        UpdateCounts(); UpdatePreview();
    }
    private void PhotoSelectionChanged(object sender, SelectionChangedEventArgs e) => UpdatePreview();
    private void SlotSelectionChanged(object sender, SelectionChangedEventArgs e) => UpdatePreview();
    private void UpdateCounts()
    {
        var assigned = slots.Count(s => s.Photo != null);
        PhotoCount.Text = $"사진 {photos.Count}장 · 대기 {photos.Count - assigned}장";
        PlacementSummary.Text = $"{assigned} / {slots.Count}장 배치 · 빈 시간 {slots.Count - assigned}개";
        ExportButton.IsEnabled = !busy && assigned > 0;
    }
    private void UpdatePreview()
    {
        if (renderer == null) return;
        var slot = SlotList.SelectedItem as Slot;
        var photo = slot?.Photo ?? PhotoList.SelectedItem as Photo;
        PreviewImage.Source = null;
        PreviewPlaceholder.Visibility = Visibility.Visible;
        PreviewCaption.Text = "";
        if (photo == null || slot == null) return;
        try
        {
            var source = ImageLoader.Load(photo.Path, Math.Min(640, photo.Size));
            PreviewImage.Source = renderer.Render(source, slot.Time, 640);
            PreviewPlaceholder.Visibility = Visibility.Collapsed;
            PreviewCaption.Text = $"{StampText.Date(slot.Time)}\n{StampText.Time(slot.Time)}" + (slot.Photo == null ? " · 배치 전 미리보기" : "");
        }
        catch (Exception ex) { Status("미리보기 오류: " + ex.Message); }
    }

    private void SetBusy(bool value)
    {
        busy = value;
        StampPage.IsEnabled = CalculatorPage.IsEnabled = CalcNav.IsEnabled = StampNav.IsEnabled = !value;
        UpdateCounts();
    }

    private async void ExportPhotos(object sender, RoutedEventArgs e)
    {
        if (busy || stampPlan == null) return;
        // Input edits must be applied so that the visible range and exported times agree.
        try
        {
            var entered = ReadPlan(StampDate, StampStart, StampEnd);
            if (entered.Start != stampPlan.Start || entered.End != stampPlan.End) { Alert("시간 입력이 변경되었습니다. ‘시간 적용’을 누른 뒤 내보내 주세요."); return; }
        }
        catch (ArgumentException ex) { Alert(ex.Message); return; }
        if (slots.Any(s => s.Photo == null)) { Alert($"아직 사진이 없는 시간이 {slots.Count(s => s.Photo == null)}개 있습니다. 모든 시간에 사진을 배치해 주세요."); return; }
        var assigned = slots.ToArray();
        var format = (string)((ComboBoxItem)OutputFormat.SelectedItem).Tag;
        var requestedSize = int.Parse((string)((ComboBoxItem)OutputSize.SelectedItem).Tag);
        string destination;
        if (format == "zip")
        {
            var dialog = new SaveFileDialog { Title = "스탬프 사진 ZIP 저장", Filter = "ZIP 파일|*.zip", FileName = $"순찰사진_{stampPlan.Start:yyyyMMdd_HHmm}.zip" };
            if (dialog.ShowDialog(this) != true) return;
            destination = dialog.FileName;
        }
        else
        {
            var dialog = new OpenFolderDialog { Title = "내보낼 폴더 선택 (안에 새 결과 폴더를 만듭니다)" };
            if (dialog.ShowDialog(this) != true) return;
            destination = Path.Combine(dialog.FolderName, $"순찰사진_{stampPlan.Start:yyyyMMdd_HHmm}_{DateTime.Now:HHmmss}_{Guid.NewGuid().ToString("N")[..4]}");
        }
        SetBusy(true);
        var completed = 0;
        try
        {
            await PhotoExporter.Export(renderer, assigned.Select(s => new ExportPhoto(s.Photo!.Path, s.Time)).ToArray(), requestedSize, format, destination,
                count => { completed = count; Status($"스탬프 출력 중 · {count} / {assigned.Length}장"); });
            Status($"내보내기 완료 · {completed}장 · {destination}");
            MessageBox.Show(this, $"스탬프 사진 {completed}장을 저장했습니다.\n\n{destination}", "내보내기 완료", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            Status($"출력 중단 · {completed}장 처리됨");
            Alert("사진 출력 중 오류가 발생했습니다.\n" + ex.Message + (format != "zip" ? $"\n완료된 {completed}장은 다음 폴더에 있습니다.\n{destination}" : "\nZIP 저장이 완료되지 않았습니다. 기존 ZIP 파일은 유지됩니다."), MessageBoxImage.Error);
        }
        finally
        {
            SetBusy(false);
        }
    }
}

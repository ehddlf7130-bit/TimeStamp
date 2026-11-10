using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using TimeStamp.Core;

namespace TimeStamp.App;

public static class ImageLoader
{
    public static BitmapSource Load(string path, int decodeSize = 0)
    {
        using var stream = File.OpenRead(path);
        var orientation = 1;
        try
        {
            var frame = BitmapFrame.Create(stream, BitmapCreateOptions.DelayCreation, BitmapCacheOption.None);
            if (frame.Metadata is BitmapMetadata metadata && metadata.GetQuery("/app1/ifd/{ushort=274}") is ushort value)
                orientation = value;
        }
        catch (Exception ex) when (ex is NotSupportedException or ArgumentException) { }
        stream.Position = 0;
        var image = new BitmapImage();
        image.BeginInit();
        image.CacheOption = BitmapCacheOption.OnLoad;
        if (decodeSize > 0) image.DecodePixelWidth = decodeSize;
        image.StreamSource = stream;
        image.EndInit();
        image.Freeze();
        var transforms = new TransformGroup();
        switch (orientation)
        {
            case 2: transforms.Children.Add(new ScaleTransform(-1, 1)); break;
            case 3: transforms.Children.Add(new RotateTransform(180)); break;
            case 4: transforms.Children.Add(new ScaleTransform(1, -1)); break;
            case 5: transforms.Children.Add(new ScaleTransform(-1, 1)); transforms.Children.Add(new RotateTransform(270)); break;
            case 6: transforms.Children.Add(new RotateTransform(90)); break;
            case 7: transforms.Children.Add(new ScaleTransform(-1, 1)); transforms.Children.Add(new RotateTransform(90)); break;
            case 8: transforms.Children.Add(new RotateTransform(270)); break;
        }
        if (transforms.Children.Count == 0) return image;
        var oriented = new TransformedBitmap(image, transforms); oriented.Freeze(); return oriented;
    }

    public static (int Width, int Height) Dimensions(string path)
    {
        using var stream = File.OpenRead(path);
        var decoder = BitmapDecoder.Create(stream, BitmapCreateOptions.DelayCreation, BitmapCacheOption.None);
        return (decoder.Frames[0].PixelWidth, decoder.Frames[0].PixelHeight);
    }

    public static void RequireSquare(int width, int height)
    {
        if (width != height) throw new ArgumentException($"1:1 사진만 입력할 수 있습니다. ({width} × {height})");
        if (width < 1 || width > 12000) throw new ArgumentException("사진 크기는 한 변 1~12,000픽셀까지 지원합니다.");
    }
}

public sealed class StampRenderer
{
    private sealed record Glyph(BitmapSource Image, double CoreLeft, double Y);
    private readonly Dictionary<string, Glyph> glyphs = new();
    private readonly Dictionary<string, double> dateMetrics;
    private readonly Dictionary<string, double> timeMetrics;
    private readonly BitmapSource logo;
    private readonly Rect logoRect;
    private readonly ShadowStyle textShadowStyle;
    private readonly ShadowStyle logoShadowStyle;
    private PlacedStamp? logoShadow;
    private PlacedStamp? textShadow;
    private DateTime? shadowTime;

    public StampRenderer()
    {
        var root = Path.Combine(AppContext.BaseDirectory, "Resources");
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "metadata", "manifest.json")));
        using var occurrences = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "metadata", "occurrences.json")));
        var lookup = occurrences.RootElement.EnumerateArray().ToDictionary(x => x.GetProperty("id").GetString()!, x => x.Clone());
        foreach (var item in document.RootElement.GetProperty("canonical").EnumerateObject())
        {
            var asset = item.Value;
            var occurrence = lookup[asset.GetProperty("source_occurrence_id").GetString()!];
            var core = occurrence.GetProperty("core_box_in_asset")[0].GetDouble();
            var trim = asset.GetProperty("trim_in_occurrence")[0].GetDouble();
            glyphs[item.Name] = new(ImageLoader.Load(Path.Combine(root, asset.GetProperty("file").GetString()!)), core - trim,
                asset.GetProperty("source_box")[1].GetDouble());
        }
        var logoAsset = document.RootElement.GetProperty("logo");
        var box = logoAsset.GetProperty("source_box");
        logo = ImageLoader.Load(Path.Combine(root, logoAsset.GetProperty("file").GetString()!));
        logoRect = new(box[0].GetDouble(), box[1].GetDouble(), box[2].GetDouble() - box[0].GetDouble(), box[3].GetDouble() - box[1].GetDouble());
        using var metrics = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "layout-metrics.json")));
        dateMetrics = ReadMetrics(metrics.RootElement.GetProperty("date"));
        timeMetrics = ReadMetrics(metrics.RootElement.GetProperty("time"));
        using var style=JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"stamp-style.json")));
        if(style.RootElement.GetProperty("referenceSize").GetInt32()!=3240)
            throw new InvalidDataException("Stamp style must use the 3240px reference canvas.");
        textShadowStyle=ReadShadowStyle(style.RootElement.GetProperty("textShadow"));
        logoShadowStyle=ReadShadowStyle(style.RootElement.GetProperty("logoShadow"));
    }

    private static Dictionary<string, double> ReadMetrics(JsonElement element) => element.GetProperty("parameters").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetDouble());

    private static ShadowStyle ReadShadowStyle(JsonElement element)
    {
        var sigma=element.GetProperty("sigmaPixels").GetDouble(); var opacity=element.GetProperty("opacity").GetDouble();
        if(!double.IsFinite(sigma)||!double.IsFinite(opacity)||sigma is < 0.1 or > 120||opacity is < 0 or > 1)
            throw new InvalidDataException("Invalid stamp shadow settings.");
        return new(sigma,opacity);
    }

    public BitmapSource Render(BitmapSource photo, DateTime dateTime, int size, bool includeShadow = true)
    {
        ImageLoader.RequireSquare(photo.PixelWidth, photo.PixelHeight);
        if (size is < 1 or > 12000) throw new ArgumentOutOfRangeException(nameof(size));
        var visual = new DrawingVisual();
        RenderOptions.SetBitmapScalingMode(visual, BitmapScalingMode.HighQuality);
        var textElements=LayoutLine(StampText.Date(dateTime),true).Concat(LayoutLine(StampText.Time(dateTime),false)).ToArray();
        if(includeShadow)
        {
            logoShadow??=StampShadow.Create(new[]{new PlacedStamp(logo,logoRect)},logoShadowStyle);
            if(shadowTime!=dateTime)
            {
                textShadow=StampShadow.Create(textElements,textShadowStyle);
                shadowTime=dateTime;
            }
        }
        using (var dc = visual.RenderOpen())
        {
            dc.DrawRectangle(Brushes.White, null, new Rect(0, 0, size, size));
            dc.DrawImage(photo, new Rect(0, 0, size, size));
            dc.PushTransform(new ScaleTransform(size / 3240d, size / 3240d));
            if(includeShadow)
            {
                dc.DrawImage(logoShadow!.Image,logoShadow.Bounds);
                dc.DrawImage(textShadow!.Image,textShadow.Bounds);
            }
            dc.DrawImage(logo, logoRect);
            foreach(var element in textElements) dc.DrawImage(element.Image,element.Bounds);
            dc.Pop();
        }
        var bitmap = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual); bitmap.Freeze(); return bitmap;
    }

    private IEnumerable<PlacedStamp> LayoutLine(string text, bool date)
    {
        var metrics = date ? dateMetrics : timeMetrics;
        var cursor = date ? 170d : 172d;
        foreach (Match match in Regex.Matches(text, @"\([^)]*\)|오전|오후|\s|.", RegexOptions.CultureInvariant))
        {
            var token = match.Value;
            if (token == " ") { cursor += metrics["advance: "]; continue; }
            var category = token.StartsWith('(') ? "weekday_token" : token.StartsWith('오') ? "period_token" : date ? "date_glyph" : "time_glyph";
            var glyph = glyphs[category + ":" + token];
            var bearing = metrics["bearing:" + token];
            yield return new(glyph.Image,new Rect(cursor + bearing - glyph.CoreLeft, glyph.Y, glyph.Image.PixelWidth, glyph.Image.PixelHeight));
            var group = char.IsAsciiDigit(token[0]) ? "digit" : token.StartsWith('오') ? "period" : token;
            cursor += metrics.GetValueOrDefault("advance:" + group);
        }
    }

    public static void Save(BitmapSource image, Stream stream, bool png)
    {
        BitmapEncoder encoder = png ? new PngBitmapEncoder() : new JpegBitmapEncoder { QualityLevel = 95 };
        encoder.Frames.Add(BitmapFrame.Create(image));
        if (stream.CanSeek) encoder.Save(stream);
        else
        {
            // WIC encoders require a seekable stream; ZIP entry streams are forward-only.
            using var buffer = new MemoryStream();
            encoder.Save(buffer); buffer.Position = 0; buffer.CopyTo(stream);
        }
    }
}

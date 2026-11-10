using System.IO;
using System.IO.Compression;
using System.Windows.Threading;

namespace TimeStamp.App;

public sealed record ExportPhoto(string Path, DateTime Time);

public static class PhotoExporter
{
    // The same pipeline serves the UI and integration checks. No external services.
    public static async Task Export(StampRenderer renderer, IReadOnlyList<ExportPhoto> photos, int requestedSize,
        string format, string destination, Action<int>? progress = null)
    {
        if (photos.Count == 0) throw new ArgumentException("출력할 사진이 없습니다.");
        if (format is not ("jpg" or "png" or "zip")) throw new ArgumentException("지원하지 않는 출력 형식입니다.");
        if (requestedSize is not (0 or 1080 or 1536 or 3240)) throw new ArgumentException("지원하지 않는 출력 크기입니다.");
        var temporaryZip = format == "zip" ? destination + "." + Guid.NewGuid().ToString("N") + ".tmp" : null;
        try
        {
            if (format != "zip") Directory.CreateDirectory(destination);
            using (var zipStream = temporaryZip != null ? new FileStream(temporaryZip, FileMode.CreateNew) : null)
            using (var archive = zipStream != null ? new ZipArchive(zipStream, ZipArchiveMode.Create) : null)
            {
                for (var i = 0; i < photos.Count; i++)
                {
                    var photo = photos[i];
                    await Dispatcher.Yield(DispatcherPriority.Background);
                    var source = await Task.Run(() =>
                    {
                        var size = ImageLoader.Dimensions(photo.Path); ImageLoader.RequireSquare(size.Width, size.Height);
                        return ImageLoader.Load(photo.Path, requestedSize > 0 && requestedSize < size.Width ? requestedSize : 0);
                    });
                    var result = renderer.Render(source, photo.Time, requestedSize == 0 ? source.PixelWidth : requestedSize);
                    var fileName = $"{i + 1:000}_{photo.Time:yyyyMMdd_HHmm}.{(format == "png" ? "png" : "jpg")}";
                    if (archive != null)
                    {
                        using var entryStream = archive.CreateEntry(fileName, CompressionLevel.NoCompression).Open();
                        StampRenderer.Save(result, entryStream, false);
                    }
                    else
                    {
                        var file = Path.Combine(destination, fileName);
                        var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
                        try
                        {
                            using (var stream = new FileStream(temporary, FileMode.CreateNew)) StampRenderer.Save(result, stream, format == "png");
                            File.Move(temporary, file); // Refuse to overwrite any existing photo.
                        }
                        finally { if (File.Exists(temporary)) File.Delete(temporary); }
                    }
                    progress?.Invoke(i + 1);
                }
            }
            if (temporaryZip != null) File.Move(temporaryZip, destination, true);
        }
        finally { if (temporaryZip != null && File.Exists(temporaryZip)) File.Delete(temporaryZip); }
    }
}

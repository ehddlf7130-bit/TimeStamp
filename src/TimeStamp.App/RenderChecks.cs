using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.IO.Compression;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace TimeStamp.App;

public static class RenderChecks
{
    public static async Task Run(string[] args)
    {
        var index = Array.IndexOf(args, "--self-test");
        var target = Path.GetFullPath(args.Length > index + 1 ? args[index + 1] : "artifacts/render-checks");
        Directory.CreateDirectory(target);
        var renderer = new StampRenderer();
        var results = new List<string>();
        void Check(bool value, string description) { if (!value) throw new Exception(description); results.Add("PASS " + description); }
        var black = Solid(3240, 3240, Brushes.Black);
        var white = Solid(3240, 3240, Brushes.White);
        var calibrationTime=new DateTime(2026,11,9,20,5,0);
        var blackBefore=renderer.Render(black,calibrationTime,1080,false);
        var blackAfter=renderer.Render(black,calibrationTime,1080);
        Check(Pixels(blackBefore).SequenceEqual(Pixels(blackAfter)),"shadow leaves black-background foreground unchanged");
        var whiteBefore=Pixels(renderer.Render(white,calibrationTime,1080,false));
        var whiteAfter=Pixels(renderer.Render(white,calibrationTime,1080));
        var shadowPixels=0;var textShadowPixels=0;var logoShadowPixels=0;var outsideChanges=0;var brighter=0;
        for(var y=0;y<1080;y++)for(var x=0;x<1080;x++)
        {
            var i=(y*1080+x)*4;
            if(whiteAfter[i]>whiteBefore[i])brighter++;
            if(whiteBefore[i]-whiteAfter[i]>1)
            {
                shadowPixels++;
                if(x<650&&y>750)textShadowPixels++;
                else if(x>700&&y<200)logoShadowPixels++;
                else outsideChanges++;
            }
        }
        Check(shadowPixels>10000&&textShadowPixels>5000&&logoShadowPixels>1000,"soft halos present around both text and logo");
        Check(outsideChanges==0,"shadow does not darken unrelated photo areas");
        Check(brighter==0,"shadow never brightens the photo");
        var whiteSmall=Pixels(renderer.Render(white,calibrationTime,1080));
        var whiteLarge=renderer.Render(white,calibrationTime,3240);
        var resizedVisual=new DrawingVisual();RenderOptions.SetBitmapScalingMode(resizedVisual,BitmapScalingMode.HighQuality);
        using(var dc=resizedVisual.RenderOpen())dc.DrawImage(whiteLarge,new Rect(0,0,1080,1080));
        var resized=new RenderTargetBitmap(1080,1080,96,96,PixelFormats.Pbgra32);resized.Render(resizedVisual);
        var whiteResized=Pixels(resized);long scalingError=0;
        for(var i=0;i<whiteSmall.Length;i+=4)scalingError+=Math.Abs(whiteSmall[i]-whiteResized[i]);
        Check(scalingError/(1080d*1080)<0.15,"shadow scale consistent at 1080 and 3240 pixels");
        foreach (var size in new[] {1080,1536,3240})
        {
            var rendered = renderer.Render(black, new(2026,11,9,0,5,0), size);
            var file = Path.Combine(target, $"stamp-{size}.png");
            using (var stream = File.Create(file)) StampRenderer.Save(rendered, stream, true);
            var loaded = ImageLoader.Load(file);
            Check(loaded.PixelWidth == size && loaded.PixelHeight == size, $"PNG {size}px reload");
            using (var stream = File.Create(Path.Combine(target, $"stamp-{size}.jpg"))) StampRenderer.Save(rendered, stream, false);
            Check(ImageLoader.Dimensions(Path.Combine(target,$"stamp-{size}.jpg")) == (size,size), $"JPEG {size}px reload");
        }
        using (var stream = File.Create(Path.Combine(target,"white-background.png"))) StampRenderer.Save(renderer.Render(white,new(2027,3,3,9,7,0),1080),stream,true);
        var squarePath = Path.Combine(target,"square-input.png");
        using (var stream = File.Create(squarePath)) StampRenderer.Save(Solid(800,800,Brushes.SteelBlue),stream,true);
        var sourceHash = SHA256.HashData(File.ReadAllBytes(squarePath));
        var photo = ImageLoader.Load(squarePath);
        using (var stream = File.Create(Path.Combine(target,"stamped-photo.jpg"))) StampRenderer.Save(renderer.Render(photo,new(2026,11,10,0,5,0),800),stream,false);
        Check(sourceHash.SequenceEqual(SHA256.HashData(File.ReadAllBytes(squarePath))), "source bytes preserved");
        try { renderer.Render(Solid(800,600,Brushes.Blue),DateTime.Today,1080); throw new Exception("non-square accepted"); }
        catch (ArgumentException) { Check(true,"non-square rejected"); }
        // Orientation 6: visual top-left red should rotate to top-right.
        var orientationInput = new DrawingVisual();
        using (var dc = orientationInput.RenderOpen()) { dc.DrawRectangle(Brushes.Blue,null,new Rect(0,0,100,100)); dc.DrawRectangle(Brushes.Red,null,new Rect(0,0,50,50)); }
        var orientationBitmap = new RenderTargetBitmap(100,100,96,96,PixelFormats.Pbgra32); orientationBitmap.Render(orientationInput);
        var metadata = new BitmapMetadata("jpg"); metadata.SetQuery("/app1/ifd/{ushort=274}",(ushort)6);
        var encoder = new JpegBitmapEncoder {QualityLevel=100}; encoder.Frames.Add(BitmapFrame.Create(orientationBitmap,null,metadata,null));
        var orientationPath = Path.Combine(target,"orientation-6.jpg"); using(var stream=File.Create(orientationPath)) encoder.Save(stream);
        var oriented = new FormatConvertedBitmap(ImageLoader.Load(orientationPath),PixelFormats.Bgra32,null,0);
        var sample = new byte[4]; oriented.CopyPixels(new Int32Rect(75,25,1,1),sample,4,0);
        Check(sample[2] > 220 && sample[0] < 30,"EXIF orientation normalized");
        // All eight sample strings are dynamically rendered, never substituted by fixed overlays.
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"Resources/metadata/manifest.json")));
        foreach (var item in manifest.RootElement.GetProperty("samples").EnumerateArray())
        {
            var id = item.GetProperty("id").GetString()!;
            var dt = DateTime.Parse(item.GetProperty("datetime_local").GetString()!,System.Globalization.CultureInfo.InvariantCulture);
            var image = renderer.Render(black,dt,3240);
            using(var stream=File.Create(Path.Combine(target,id+"-dynamic.png"))) StampRenderer.Save(image,stream,true);
            Check(image.PixelWidth==3240,"dynamic sample " + id);
            var referencePath = Path.Combine(Environment.CurrentDirectory,"handoff/timestamp_codex_handoff",item.GetProperty("reference_overlay").GetString()!);
            if (File.Exists(referencePath))
            {
                var reference = new FormatConvertedBitmap(ImageLoader.Load(referencePath),PixelFormats.Pbgra32,null,0);
                var actual = new byte[3240*3240*4]; image.CopyPixels(actual,3240*4,0);
                var expected = new byte[actual.Length]; reference.CopyPixels(expected,3240*4,0);
                var diff = new byte[actual.Length]; long sum = 0; var maximum = 0;
                for (var p=0;p<actual.Length;p+=4)
                {
                    var d=Math.Abs(actual[p]-expected[p+3]); sum+=d; maximum=Math.Max(maximum,d);
                    diff[p]=diff[p+1]=diff[p+2]=(byte)Math.Min(255,d*3); diff[p+3]=255;
                }
                results.Add($"MEASURE {id}: full-frame mean absolute luminance error {sum/(3240d*3240):F4}/255, max {maximum}/255 (difference image amplified 3x)");
                var difference=BitmapSource.Create(3240,3240,96,96,PixelFormats.Bgra32,null,diff,3240*4);
                using var stream=File.Create(Path.Combine(target,id+"-difference-x3.png")); StampRenderer.Save(difference,stream,true);
            }
        }
        // Real UI handlers, collections and export service; all inputs are synthetic fixtures.
        var fixtures=Path.Combine(target,"fixtures"); Directory.CreateDirectory(fixtures);
        var fixturePaths=new List<string>();
        foreach(var (name, brush) in new[] {("01",Brushes.SlateGray),("02",Brushes.Teal),("03",Brushes.DarkSlateBlue),("04",Brushes.SteelBlue),("05",Brushes.DarkOliveGreen),("06",Brushes.IndianRed)})
        {
            var file=Path.Combine(fixtures,name+".png");
            using(var stream=File.Create(file)) StampRenderer.Save(Solid(800,800,brush),stream,true);
            fixturePaths.Add(file);
        }
        using(var stream=File.Create(Path.Combine(fixtures,"not-square.png"))) StampRenderer.Save(Solid(800,600,Brushes.Blue),stream,true);
        var window = new MainWindow();
        var calcDate=(DatePicker)window.FindName("CalcDate"); calcDate.SelectedDate=new DateTime(2026,11,9);
        ((TextBox)window.FindName("CalcStart")).Text="00:00";
        ((TextBox)window.FindName("CalcEnd")).Text="00:30";
        Check(window.CalculatePlan(false),"UI calculation handler accepts half hour");
        Check(((TextBlock)window.FindName("CountText")).Text=="6","UI displays six photos");
        SaveWindow(window,Path.Combine(target,"calculator-ui.png"));
        var plan=Core.PatrolPlan.Create(new(2026,11,9),"23:30","00:00");
        window.SetStampPlan(plan);
        ((DatePicker)window.FindName("StampDate")).SelectedDate=plan.Start.Date;
        ((TextBox)window.FindName("StampStart")).Text="23:30";
        ((TextBox)window.FindName("StampEnd")).Text="00:00";
        await window.LoadPhotos(fixturePaths);
        var photoList=(ListBox)window.FindName("PhotoList"); var slotList=(ListBox)window.FindName("SlotList");
        Check(photoList.Items.Count==6,"UI multiple-photo import");
        await window.LoadPhotos(fixturePaths.Take(1));
        Check(photoList.Items.Count==6,"UI duplicate import skipped");
        window.Arrange(false);
        var uiSlots=slotList.Items.Cast<Slot>().ToArray();
        Check(uiSlots.All(s=>s.Photo!=null),"UI sequential assignment fills all slots");
        Check(uiSlots[0].Photo!.Name=="01.png" && uiSlots[^1].Photo!.Name=="06.png","UI preserves import order");
        window.Arrange(true);
        Check(uiSlots.Select(s=>s.Photo).Distinct().Count()==6,"UI random assignment without repeats");
        photoList.SelectedIndex=0;
        var prior=Array.FindIndex(uiSlots,s=>ReferenceEquals(s.Photo,photoList.SelectedItem));
        var targetSlot=(prior+1)%uiSlots.Length; var displaced=uiSlots[targetSlot].Photo;
        slotList.SelectedIndex=targetSlot;
        window.AssignPhoto(window,new RoutedEventArgs());
        Check(ReferenceEquals(uiSlots[targetSlot].Photo,photoList.SelectedItem) && uiSlots[prior].Photo==displaced,"UI manual assignment swaps photos");
        window.Navigate(true);
        SaveWindow(window,Path.Combine(target,"studio-ui.png"));
        var exportPhotos=uiSlots.Select(s=>new ExportPhoto(s.Photo!.Path,s.Time)).ToArray();
        var zipPath=Path.Combine(target,"batch.zip");
        await PhotoExporter.Export(renderer,exportPhotos,1080,"zip",zipPath);
        using(var archive=ZipFile.OpenRead(zipPath))
        {
            Check(archive.Entries.Count==6,"batch ZIP contains six photos");
            Check(archive.Entries[0].Name=="001_20261109_2335.jpg" && archive.Entries[^1].Name=="006_20261110_0000.jpg","batch filenames include midnight date rollover");
            foreach(var entry in archive.Entries)
            {
                using var stream=entry.Open(); using var buffer=new MemoryStream(); stream.CopyTo(buffer); buffer.Position=0;
                var decoder=BitmapDecoder.Create(buffer,BitmapCreateOptions.None,BitmapCacheOption.OnLoad);
                Check(decoder.Frames[0].PixelWidth==1080,"ZIP entry decodes: "+entry.Name);
            }
        }
        foreach(var format in new[]{"png","jpg"})
        {
            var folder=Path.Combine(target,"batch-"+format+"-"+Guid.NewGuid().ToString("N")[..6]);
            await PhotoExporter.Export(renderer,exportPhotos,0,format,folder);
            Check(Directory.GetFiles(folder).Length==6 && Directory.GetFiles(folder).All(f=>ImageLoader.Dimensions(f)==(800,800)),"batch "+format+" keeps original resolution");
        }
        var preservedZipHash=SHA256.HashData(File.ReadAllBytes(zipPath));
        try
        {
            await PhotoExporter.Export(renderer,new[]{new ExportPhoto(Path.Combine(fixtures,"not-square.png"),DateTime.Today)},1080,"zip",zipPath);
            throw new Exception("invalid export accepted");
        }
        catch(ArgumentException) { Check(preservedZipHash.SequenceEqual(SHA256.HashData(File.ReadAllBytes(zipPath))),"failed ZIP export preserves previous output"); }
        Check(!Directory.GetFiles(target,"*.tmp").Any(),"no temporary ZIP remains");
        window.Close();
        File.WriteAllLines(Path.Combine(target,"results.txt"),results);
    }

    private static void SaveWindow(MainWindow window,string file)
    {
        var content=(FrameworkElement)window.Content;
        content.Measure(new Size(1320,860)); content.Arrange(new Rect(0,0,1320,860)); content.UpdateLayout();
        var image=new RenderTargetBitmap(1320,860,96,96,PixelFormats.Pbgra32); image.Render(content);
        using var stream=File.Create(file); StampRenderer.Save(image,stream,true);
    }

    private static byte[] Pixels(BitmapSource image)
    {
        var converted=new FormatConvertedBitmap(image,PixelFormats.Bgra32,null,0);
        var pixels=new byte[image.PixelWidth*image.PixelHeight*4];converted.CopyPixels(pixels,image.PixelWidth*4,0);return pixels;
    }

    private static BitmapSource Solid(int width, int height, Brush color)
    {
        var visual = new DrawingVisual();
        using(var dc=visual.RenderOpen()) dc.DrawRectangle(color,null,new Rect(0,0,width,height));
        var image=new RenderTargetBitmap(width,height,96,96,PixelFormats.Pbgra32); image.Render(visual); image.Freeze(); return image;
    }
}

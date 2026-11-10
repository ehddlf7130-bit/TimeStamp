using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using TimeStamp.App;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length < 3) throw new ArgumentException("original.jpg program.jpg output-directory");
        var target=Path.GetFullPath(args[2]); Directory.CreateDirectory(target);
        var original=ImageLoader.Load(args[0]); var program=ImageLoader.Load(args[1]);
        Console.WriteLine($"Original {original.PixelWidth}x{original.PixelHeight}; Program {program.PixelWidth}x{program.PixelHeight}");
        var o=Resize(original,1080); var p=Resize(program,1080);
        Save(o,Path.Combine(target,"original-1080.png")); Save(p,Path.Combine(target,"program-1080.png"));
        Dump(o,Path.Combine(target,"original.bgra")); Dump(p,Path.Combine(target,"program.bgra"));
        var renderer=new StampRenderer();
        var timestamp=new DateTime(2026,11,9,20,5,0);
        var largeMask=renderer.Render(Solid(program.PixelWidth,Brushes.Black),timestamp,program.PixelWidth,false);
        var mask=Resize(largeMask,1080);
        var nativeMask=renderer.Render(Solid(1080,Brushes.Black),timestamp,1080,false);
        Save(mask,Path.Combine(target,"mask.png")); Dump(mask,Path.Combine(target,"mask.bgra")); Dump(nativeMask,Path.Combine(target,"mask-native.bgra"));
        Save(Panel(new[]{o,p},new[]{"ORIGINAL / 1080 px","PROGRAM / normalized to 1080 px"},new Int32Rect(45,805,500,140),2),Path.Combine(target,"text-before.png"));
        Save(Panel(new[]{o,p},new[]{"ORIGINAL","PROGRAM"},new Int32Rect(780,65,245,75),3),Path.Combine(target,"logo-before.png"));
        var correctedPath=Path.Combine(target,"shadow-corrected.bgra");
        if(File.Exists(correctedPath))
        {
            var corrected=BitmapSource.Create(1080,1080,96,96,PixelFormats.Bgra32,null,File.ReadAllBytes(correctedPath),1080*4);
            Save(corrected,Path.Combine(target,"shadow-corrected.png"));
            Save(Panel(new[]{o,p,corrected},new[]{"ORIGINAL","BEFORE","SHADOW CALIBRATION PREVIEW"},new Int32Rect(45,805,500,140),2),Path.Combine(target,"text-shadow-preview.png"));
        }
        // Apply just the renderer's new shadow to the already-stamped supplied export.
        // This avoids adding a second foreground stamp. It is a calibration preview,
        // not a reconstruction of the unavailable unstamped source photo.
        var shadowOnWhite=renderer.Render(Solid(program.PixelWidth,Brushes.White),timestamp,program.PixelWidth);
        var correctedNative=ApplyShadow(program,largeMask,shadowOnWhite);
        var correctedActual=Resize(correctedNative,1080);
        Save(correctedNative,Path.Combine(target,"corrected-program.png"));
        Save(correctedActual,Path.Combine(target,"corrected-1080.png"));
        Dump(correctedActual,Path.Combine(target,"corrected.bgra"));
        Save(Panel(new[]{o,p,correctedActual},new[]{"ORIGINAL / 1080 px","PREVIOUS PROGRAM / normalized","UPDATED SHADOW / normalized"},new Int32Rect(45,805,500,140),2),Path.Combine(target,"text-comparison.png"));
        Save(Panel(new[]{o,p,correctedActual},new[]{"ORIGINAL","PREVIOUS PROGRAM","UPDATED SHADOW"},new Int32Rect(780,65,245,75),3),Path.Combine(target,"logo-comparison.png"));
        var report=new{originalSize=original.PixelWidth,programSize=program.PixelWidth,
            text=Measure(o,p,correctedActual,new Int32Rect(45,805,505,140)),
            logo=Measure(o,p,correctedActual,new Int32Rect(780,65,250,75)),
            method="Existing program export adjusted using the updated renderer's shadow coverage; no second foreground. Comparison normalized to 1080px. JPEG/resampling and foreground differences remain."};
        File.WriteAllText(Path.Combine(target,"comparison-metrics.json"),JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
        Console.WriteLine(JsonSerializer.Serialize(report));
        File.WriteAllText(Path.Combine(target,"input-info.json"),JsonSerializer.Serialize(new {original=new{width=original.PixelWidth,height=original.PixelHeight},program=new{width=program.PixelWidth,height=program.PixelHeight}},new JsonSerializerOptions{WriteIndented=true}));
    }
    private static byte[] Pixels(BitmapSource image)
    {
        var converted=new FormatConvertedBitmap(image,PixelFormats.Bgra32,null,0);
        var data=new byte[image.PixelWidth*image.PixelHeight*4]; converted.CopyPixels(data,image.PixelWidth*4,0); return data;
    }
    private static BitmapSource ApplyShadow(BitmapSource photo,BitmapSource foregroundOnBlack,BitmapSource shadowOnWhite)
    {
        var pixels=Pixels(photo); var alpha=Pixels(foregroundOnBlack); var white=Pixels(shadowOnWhite);
        for(var i=0;i<pixels.Length;i+=4) for(var c=0;c<3;c++)
        {
            var deficit=255-white[i+c];
            var coverage=alpha[i+c];
            var shadow=deficit/(double)Math.Max(1,255-coverage);
            pixels[i+c]=(byte)Math.Clamp((int)Math.Round(pixels[i+c]-Math.Max(0,pixels[i+c]-coverage)*shadow),0,255);
        }
        var image=BitmapSource.Create(photo.PixelWidth,photo.PixelHeight,96,96,PixelFormats.Bgra32,null,pixels,photo.PixelWidth*4); image.Freeze();return image;
    }
    private static object Measure(BitmapSource original,BitmapSource before,BitmapSource after,Int32Rect area)
    {
        var o=Pixels(original); var b=Pixels(before); var a=Pixels(after); long oldError=0,newError=0; var count=0;
        for(var y=area.Y;y<area.Y+area.Height;y++)for(var x=area.X;x<area.X+area.Width;x++)for(var c=0;c<3;c++)
        {
            var i=(y*original.PixelWidth+x)*4+c;oldError+=Math.Abs(o[i]-b[i]);newError+=Math.Abs(o[i]-a[i]);count++;
        }
        return new{meanAbsoluteErrorBefore=oldError/(double)count,meanAbsoluteErrorAfter=newError/(double)count,improvementPercent=100d*(oldError-newError)/oldError};
    }
    internal static BitmapSource Resize(BitmapSource image,int size)
    {
        var visual=new DrawingVisual(); RenderOptions.SetBitmapScalingMode(visual,BitmapScalingMode.HighQuality);
        using(var dc=visual.RenderOpen()) dc.DrawImage(image,new Rect(0,0,size,size));
        var bitmap=new RenderTargetBitmap(size,size,96,96,PixelFormats.Pbgra32); bitmap.Render(visual); bitmap.Freeze(); return bitmap;
    }
    internal static BitmapSource Solid(int size,Brush brush)
    {
        var visual=new DrawingVisual(); using(var dc=visual.RenderOpen()) dc.DrawRectangle(brush,null,new Rect(0,0,size,size));
        var bitmap=new RenderTargetBitmap(size,size,96,96,PixelFormats.Pbgra32); bitmap.Render(visual); bitmap.Freeze(); return bitmap;
    }
    internal static void Dump(BitmapSource image,string file)
    {
        var converted=new FormatConvertedBitmap(image,PixelFormats.Bgra32,null,0);
        var data=new byte[image.PixelWidth*image.PixelHeight*4]; converted.CopyPixels(data,image.PixelWidth*4,0); File.WriteAllBytes(file,data);
    }
    internal static void Save(BitmapSource image,string file)
    {
        using var stream=File.Create(file); StampRenderer.Save(image,stream,true);
    }
    internal static BitmapSource Panel(BitmapSource[] images,string[] labels,Int32Rect crop,int scale)
    {
        var width=crop.Width*scale; var height=crop.Height*scale+42;
        var visual=new DrawingVisual(); RenderOptions.SetBitmapScalingMode(visual,BitmapScalingMode.NearestNeighbor);
        using(var dc=visual.RenderOpen())
        {
            dc.DrawRectangle(Brushes.White,null,new Rect(0,0,width,images.Length*height));
            for(var i=0;i<images.Length;i++)
            {
                dc.DrawText(new FormattedText(labels[i],System.Globalization.CultureInfo.InvariantCulture,FlowDirection.LeftToRight,new Typeface("Segoe UI"),16,Brushes.Black,1),new Point(12,i*height+9));
                dc.DrawImage(new CroppedBitmap(images[i],crop),new Rect(0,i*height+42,width,crop.Height*scale));
            }
        }
        var result=new RenderTargetBitmap(width,images.Length*height,96,96,PixelFormats.Pbgra32); result.Render(visual); result.Freeze();return result;
    }
}

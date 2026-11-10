using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace TimeStamp.App;

internal sealed record PlacedStamp(BitmapSource Image, Rect Bounds);
internal sealed record ShadowStyle(double SigmaPixels, double Opacity);

internal static class StampShadow
{
    /// <summary>
    /// Render only the stamp's small tile. Three separable running-sum box filters
    /// approximate a Gaussian in linear time; the photo is never blurred or darkened globally.
    /// All coordinates are in the 3240px reference space, before the final output scale.
    /// </summary>
    internal static PlacedStamp Create(IReadOnlyList<PlacedStamp> elements, ShadowStyle style)
    {
        var bounds=Rect.Empty;
        foreach(var element in elements) bounds.Union(element.Bounds);
        // Three boxes have finite support beyond 3 sigma. Keep that entire support,
        // including transparent padding, to avoid a rectangular clipping seam.
        var widths=BoxWidths(style.SigmaPixels);
        var padding=widths.Sum(w=>(w-1)/2)+3;
        var left=(int)Math.Floor(bounds.Left)-padding;
        var top=(int)Math.Floor(bounds.Top)-padding;
        var width=(int)Math.Ceiling(bounds.Right)-left+padding;
        var height=(int)Math.Ceiling(bounds.Bottom)-top+padding;
        var visual=new DrawingVisual();
        RenderOptions.SetBitmapScalingMode(visual,BitmapScalingMode.HighQuality);
        using(var dc=visual.RenderOpen())
        {
            dc.PushTransform(new TranslateTransform(-left,-top));
            foreach(var element in elements) dc.DrawImage(element.Image,element.Bounds);
            dc.Pop();
        }
        var mask=new RenderTargetBitmap(width,height,96,96,PixelFormats.Pbgra32); mask.Render(visual);
        var pixels=new byte[width*height*4]; mask.CopyPixels(pixels,width*4,0);
        var alpha=new float[width*height]; var work=new float[alpha.Length];
        for(var i=0;i<alpha.Length;i++) alpha[i]=pixels[i*4+3];
        foreach(var boxWidth in widths)
        {
            BoxHorizontal(alpha,work,width,height,boxWidth);
            BoxVertical(work,alpha,width,height,boxWidth);
        }
        // A black premultiplied bitmap has zero RGB, with only shadow coverage in A.
        Array.Clear(pixels);
        for(var i=0;i<alpha.Length;i++) pixels[i*4+3]=(byte)Math.Clamp((int)Math.Round(alpha[i]*style.Opacity),0,255);
        var bitmap=BitmapSource.Create(width,height,96,96,PixelFormats.Pbgra32,null,pixels,width*4); bitmap.Freeze();
        return new(bitmap,new Rect(left,top,width,height));
    }

    private static int[] BoxWidths(double sigma)
    {
        var lower=(int)Math.Floor(Math.Sqrt(4*sigma*sigma+1));
        if(lower%2==0) lower--;
        lower=Math.Max(1,lower);
        var lowerCount=(int)Math.Round((12*sigma*sigma-3*lower*lower-12*lower-9)/(-4d*lower-4));
        return Enumerable.Range(0,3).Select(i=>i<lowerCount?lower:lower+2).ToArray();
    }

    private static void BoxHorizontal(float[] source,float[] target,int width,int height,int boxWidth)
    {
        var radius=boxWidth/2;
        for(var y=0;y<height;y++)
        {
            var row=y*width; double sum=0;
            for(var x=0;x<=radius&&x<width;x++) sum+=source[row+x];
            for(var x=0;x<width;x++)
            {
                target[row+x]=(float)(sum/boxWidth);
                var remove=x-radius; var add=x+radius+1;
                if(remove>=0) sum-=source[row+remove];
                if(add<width) sum+=source[row+add];
            }
        }
    }

    private static void BoxVertical(float[] source,float[] target,int width,int height,int boxWidth)
    {
        var radius=boxWidth/2;
        for(var x=0;x<width;x++)
        {
            double sum=0;
            for(var y=0;y<=radius&&y<height;y++) sum+=source[y*width+x];
            for(var y=0;y<height;y++)
            {
                target[y*width+x]=(float)(sum/boxWidth);
                var remove=y-radius; var add=y+radius+1;
                if(remove>=0) sum-=source[remove*width+x];
                if(add<height) sum+=source[add*width+x];
            }
        }
    }
}

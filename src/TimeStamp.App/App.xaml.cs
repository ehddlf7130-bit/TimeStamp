using System.IO;
using System.Windows;

namespace TimeStamp.App;

public partial class App : Application
{
    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (e.Args.Contains("--self-test"))
        {
            try { await RenderChecks.Run(e.Args); Shutdown(0); }
            catch (Exception ex) { File.WriteAllText("render-check-error.txt", ex.ToString()); Shutdown(1); }
            return;
        }
        DispatcherUnhandledException += (_, args) =>
        {
            MessageBox.Show("작업을 완료하지 못했습니다.\n" + args.Exception.Message, "타임스탬프", MessageBoxButton.OK, MessageBoxImage.Error);
            args.Handled = true;
        };
        new MainWindow().Show();
    }
}

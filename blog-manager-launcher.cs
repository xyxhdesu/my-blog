using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class BlogManagerLauncher
{
    [STAThread]
    private static void Main()
    {
        string baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string scriptPath = Path.Combine(baseDirectory, "blog-manager-gui.ps1");

        if (!File.Exists(scriptPath))
        {
            MessageBox.Show(
                "\u672a\u627e\u5230\u535a\u5ba2\u7ba1\u7406\u5668\u754c\u9762\u6587\u4ef6\u3002",
                "\u535a\u5ba2\u7ba1\u7406\u5668",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        string systemDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System);
        string powershell = Path.Combine(systemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
        if (!File.Exists(powershell))
        {
            powershell = "powershell.exe";
        }

        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = powershell,
                Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + scriptPath.Replace("\"", "\\\"") + "\"",
                WorkingDirectory = baseDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            Process.Start(startInfo);
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                "\u542f\u52a8\u5931\u8d25\uff1a" + exception.Message,
                "\u535a\u5ba2\u7ba1\u7406\u5668",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }
}

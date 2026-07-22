// DeskWidget 실행.exe — 배포 최상위의 작은 Windows GUI 런처(C#/.NET Framework, managed PE).
// "안 보셔도 됩니다\DeskWidget.exe"를 상대 경로로만 찾아서 실행한다.
// 관리자 권한 상승, 네트워크, 셸(cmd/PowerShell) 호출, 사용자 입력 기반 경로 조합이 전혀 없다.
// mscorlib(P/Invoke)만 사용해 csc.exe 기본 빌드(추가 /reference 불필요)로 컴파일된다.
// 실행하려면 대상 Windows에 .NET Framework 런타임이 있어야 한다(Windows 10/11 기본 포함).
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static class Launcher
{
    private const string InnerFolderName = "안 보셔도 됩니다";
    private const string InnerExeName = "DeskWidget.exe";

    private const uint MB_OK = 0x00000000;
    private const uint MB_ICONERROR = 0x00000010;

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetModuleFileNameW(IntPtr hModule, StringBuilder lpFilename, int nSize);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(
        string lpApplicationName,
        StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    private static string GetOwnExecutablePath()
    {
        var buffer = new StringBuilder(260);
        while (true)
        {
            uint length = GetModuleFileNameW(IntPtr.Zero, buffer, buffer.Capacity);
            if (length == 0) throw new InvalidOperationException("GetModuleFileNameW failed");
            if (length < buffer.Capacity) return buffer.ToString();
            buffer.Capacity *= 2;
        }
    }

    private static void ShowError(string message)
    {
        MessageBoxW(IntPtr.Zero, message, "DeskWidget", MB_OK | MB_ICONERROR);
    }

    private static int Main()
    {
        string ownDir;
        try
        {
            ownDir = Path.GetDirectoryName(GetOwnExecutablePath());
        }
        catch (Exception)
        {
            ShowError("DeskWidget 실행 위치를 확인하지 못했습니다.");
            return 1;
        }

        string innerDir = Path.Combine(ownDir, InnerFolderName);
        string innerExePath = Path.Combine(innerDir, InnerExeName);

        if (!File.Exists(innerExePath))
        {
            ShowError(
                "DeskWidget 실행 파일을 찾을 수 없습니다.\n\n" +
                "\"" + InnerFolderName + "\" 폴더가 이 실행 파일과 같은 위치에 있는지 확인한 뒤 다시 시도해 주세요.\n" +
                "이 파일만 다른 곳으로 옮기면 실행할 수 없으니, 압축을 푼 폴더째로 이동해 주세요.");
            return 1;
        }

        var startupInfo = new STARTUPINFO();
        startupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        var commandLine = new StringBuilder("\"" + innerExePath + "\"");
        PROCESS_INFORMATION processInfo;

        bool started = CreateProcessW(
            innerExePath,
            commandLine,
            IntPtr.Zero,
            IntPtr.Zero,
            false,
            0,
            IntPtr.Zero,
            innerDir,
            ref startupInfo,
            out processInfo);

        if (!started)
        {
            ShowError("DeskWidget을 실행하지 못했습니다. 잠시 후 다시 시도해 주세요.");
            return 1;
        }

        CloseHandle(processInfo.hProcess);
        CloseHandle(processInfo.hThread);
        return 0;
    }
}

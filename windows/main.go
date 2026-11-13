//go:build windows

// SP Tool for Windows – native launcher, installer and system bridge.
//
//	SPTool.exe               first start from anywhere: installs itself for the current user
//	                         (no admin), creates Start menu + desktop shortcuts and an entry in
//	                         "Apps & features", then starts SP Tool.
//	SPTool.exe (installed)   opens SP Tool in its own native window (WebView2 engine built into
//	                         Windows 10/11, own icon + dark title bar). Closing the window ends it.
//	SPTool.exe --uninstall   removes SP Tool (your projects and settings are kept).
//
// Native features for the app (same-origin only, never reachable from other websites):
//
//	GET  /native/info          version, machine id (Windows MachineGuid) for the license HWID
//	GET  /native/detect/fivem  FiveM install + running state
//	GET  /native/detect/gta    GTA V installs (Rockstar, Steam, Epic, FiveM config)
//	POST /native/open          open an https link in the user's browser (Discord sign-in)
//	POST /native/heartbeat     kept for compatibility
package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"

	"sptool/windows/installer"
)

//go:embed all:web
var webFS embed.FS

var version = "dev" // set with -ldflags "-X main.version=…"

const (
	appName   = "SP Tool"
	publisher = "Turbo Design"
	exeName   = "SPTool.exe"
	uninstKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\SPTool`
)

var (
	user32       = syscall.NewLazyDLL("user32.dll")
	kernel32     = syscall.NewLazyDLL("kernel32.dll")
	pMessageBox  = user32.NewProc("MessageBoxW")
	pCreateMutex = kernel32.NewProc("CreateMutexW")
)

const (
	mbOK          = 0x0
	mbYesNo       = 0x4
	mbIconError   = 0x10
	mbIconQuest   = 0x20
	mbIconInfo    = 0x40
	idYes         = 6
	createNoWin   = 0x08000000
	errAlreadyExt = 183
)

func msgBox(text string, flags uintptr) int {
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(appName)
	r, _, _ := pMessageBox.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags)
	return int(r)
}

func fatal(format string, a ...any) {
	msg := fmt.Sprintf(format, a...)
	log.Println("FATAL:", msg)
	msgBox(msg, mbOK|mbIconError)
	os.Exit(1)
}

func hidden(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWin}
	return cmd
}

func localAppData() string {
	if v := os.Getenv("LOCALAPPDATA"); v != "" {
		return v
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, "AppData", "Local")
}

var (
	installDir = filepath.Join(localAppData(), "Programs", "SPTool")
	dataDir    = filepath.Join(localAppData(), "SPTool")
)

func main() {
	_ = os.MkdirAll(dataDir, 0o755)
	if f, err := os.OpenFile(filepath.Join(dataDir, "launcher.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644); err == nil {
		log.SetOutput(f)
	}
	log.Printf("SP Tool %s starting: %v", version, os.Args)

	self, err := os.Executable()
	if err != nil {
		fatal("Pfad der Anwendung unbekannt: %v", err)
	}
	for _, a := range os.Args[1:] {
		switch strings.ToLower(a) {
		case "--uninstall", "/uninstall":
			uninstall()
			return
		case "--portable":
			run()
			return
		}
	}
	if !strings.EqualFold(filepath.Clean(filepath.Dir(self)), filepath.Clean(installDir)) {
		install(self)
		return
	}
	run()
}

// ── install / uninstall ──────────────────────────────────────────────────────

func psQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func install(self string) {
	target := filepath.Join(installDir, exeName)
	// Close a running SP Tool so the file can be replaced (update).
	// Never in the middle of an install or restore: wait (up to 2 minutes) until it is done.
	for i := 0; i < 240 && installer.Busy(dataDir); i++ {
		time.Sleep(500 * time.Millisecond)
	}
	// Only OTHER instances – the downloaded file has the same name as the installed one.
	_ = hidden("taskkill", "/F", "/IM", exeName, "/FI", fmt.Sprintf("PID ne %d", os.Getpid())).Run()
	time.Sleep(400 * time.Millisecond)
	_ = os.Remove(sessionMarker()) // closed on purpose, not a crash
	if err := os.MkdirAll(installDir, 0o755); err != nil {
		fatal("Installation fehlgeschlagen: %v", err)
	}
	if err := copyFile(self, target); err != nil {
		// Could not install (locked file, policy, antivirus): still start SP Tool from here.
		log.Println("install copy failed, running portable:", err)
		run()
		return
	}
	// Shortcuts: Start menu + desktop (via the Windows Script Host COM object).
	ps := fmt.Sprintf(`$w=New-Object -ComObject WScript.Shell;`+
		`foreach($p in @([Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('Desktop'))){`+
		`$s=$w.CreateShortcut((Join-Path $p 'SP Tool.lnk'));$s.TargetPath=%s;$s.WorkingDirectory=%s;$s.IconLocation=%s;$s.Description='SP Tool - FiveM Soundpack Creator';$s.Save()}`,
		psQuote(target), psQuote(installDir), psQuote(target+",0"))
	if err := hidden("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps).Run(); err != nil {
		log.Println("shortcuts:", err)
	}
	// "Apps & features" entry
	regs := [][]string{
		{"DisplayName", "REG_SZ", appName},
		{"DisplayVersion", "REG_SZ", version},
		{"Publisher", "REG_SZ", publisher},
		{"DisplayIcon", "REG_SZ", target + ",0"},
		{"InstallLocation", "REG_SZ", installDir},
		{"UninstallString", "REG_SZ", `"` + target + `" --uninstall`},
		{"NoModify", "REG_DWORD", "1"},
		{"NoRepair", "REG_DWORD", "1"},
	}
	for _, r := range regs {
		_ = hidden("reg", "add", uninstKey, "/v", r[0], "/t", r[1], "/d", r[2], "/f").Run()
	}
	log.Println("installed to", installDir)
	if err := exec.Command(target).Start(); err != nil {
		log.Println("start installed failed, running portable:", err)
		run()
	}
}

func uninstall() {
	if msgBox("SP Tool wirklich deinstallieren?\n\nDeine Projekte und Einstellungen bleiben erhalten.", mbYesNo|mbIconQuest) != idYes {
		return
	}
	ps := `foreach($p in @([Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('Desktop'))){Remove-Item (Join-Path $p 'SP Tool.lnk') -Force -ErrorAction SilentlyContinue}`
	_ = hidden("powershell", "-NoProfile", "-Command", ps).Run()
	_ = hidden("reg", "delete", uninstKey, "/f").Run()
	// The running exe cannot delete itself: let cmd remove the folder after we exit.
	_ = hidden("cmd", "/c", "ping 127.0.0.1 -n 3 >nul & rmdir /s /q \""+installDir+"\"").Start()
	msgBox("SP Tool wurde entfernt.", mbOK|mbIconInfo)
}

func copyFile(src, dst string) error {
	if strings.EqualFold(src, dst) {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".new"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err = io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err = out.Close(); err != nil {
		return err
	}
	// Rename over the target in one step (replaces it on Windows); if that fails the old exe stays.
	if err = os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
	}
	return err
}

// ── run ─────────────────────────────────────────────────────────────────────

var lastBeat atomic.Int64

func singleInstance() bool {
	name, _ := syscall.UTF16PtrFromString(`Local\SPToolApp`)
	h, _, err := pCreateMutex.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if h == 0 {
		return true
	}
	if errno, ok := err.(syscall.Errno); ok && errno == errAlreadyExt {
		return false
	}
	return true
}

// The window must live on the main OS thread. That thread also needs OLE (not only COM): WebView2 registers its
// drop target through OLE, so without OleInitialize dragging files from Explorer into SP Tool shows a "forbidden"
// cursor and nothing arrives. go-webview2 only calls CoInitializeEx; OleInitialize on the same STA thread is allowed.
func init() {
	runtime.LockOSThread()
	if r, _, _ := syscall.NewLazyDLL("ole32.dll").NewProc("OleInitialize").Call(0); int32(r) < 0 {
		log.Printf("OleInitialize failed: %08x – drag & drop from Explorer may not work", r)
	}
}

var (
	pFindWindow    = user32.NewProc("FindWindowW")
	pShowWindow    = user32.NewProc("ShowWindow")
	pSetForeground = user32.NewProc("SetForegroundWindow")
	pDwmSetAttr    = syscall.NewLazyDLL("dwmapi.dll").NewProc("DwmSetWindowAttribute")
	pShellExecute  = syscall.NewLazyDLL("shell32.dll").NewProc("ShellExecuteW")
)

const windowTitle = "SP Tool"

func focusExisting() {
	t, _ := syscall.UTF16PtrFromString(windowTitle)
	if h, _, _ := pFindWindow.Call(0, uintptr(unsafe.Pointer(t))); h != 0 {
		pShowWindow.Call(h, 9) // SW_RESTORE
		pSetForeground.Call(h)
	}
}

// Dark title bar in the Turbo Design colours (Windows 10 20H1+ / Windows 11).
func styleWindow(hwnd uintptr) {
	dark := int32(1)
	pDwmSetAttr.Call(hwnd, 20, uintptr(unsafe.Pointer(&dark)), 4) // DWMWA_USE_IMMERSIVE_DARK_MODE
	caption := uint32(0x000E0805)                                 // COLORREF 0x00BBGGRR = #05080E
	pDwmSetAttr.Call(hwnd, 35, uintptr(unsafe.Pointer(&caption)), 4)
	border := uint32(0x00FF7B1F) // #1F7BFF
	pDwmSetAttr.Call(hwnd, 34, uintptr(unsafe.Pointer(&border)), 4)
	text := uint32(0x00FBF3EE)
	pDwmSetAttr.Call(hwnd, 36, uintptr(unsafe.Pointer(&text)), 4)
}

func openInBrowser(u string) {
	verb, _ := syscall.UTF16PtrFromString("open")
	target, _ := syscall.UTF16PtrFromString(u)
	pShellExecute.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(target)), 0, 0, 1)
}

// Crash detection: a marker exists while the window is open and is removed on a clean close – also right before an
// update or a new install replaces this instance. Still there on the next start → the last session ended unexpectedly.
var lastRunCrashed bool

func sessionMarker() string { return filepath.Join(dataDir, "session-open") }

func run() {
	if !singleInstance() {
		focusExisting()
		return
	}
	cleanOldUpdates()
	// leftovers of failed or abandoned installs
	go (&installer.Manager{DataDir: dataDir}).CleanStaging(24 * time.Hour)
	// Fixed port: the app keeps your projects and login per address.
	var ln net.Listener
	var port int
	for _, p := range []int{47615, 47616, 47617, 47618} {
		l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			ln, port = l, p
			break
		}
	}
	if ln == nil {
		fatal("Kein freier Port (47615–47618) – läuft SP Tool schon?")
	}
	go func() { _ = http.Serve(ln, handler(port)) }()
	url := fmt.Sprintf("http://localhost:%d/", port)
	log.Println("serving", url)

	// Native window with the WebView2 engine that ships with Windows 10/11.
	_ = os.Setenv("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "FF03050A") // no white flash
	_ = os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--autoplay-policy=no-user-gesture-required --disable-features=msSmartScreenProtection")
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  filepath.Join(dataDir, "webview"),
		WindowOptions: webview2.WindowOptions{
			Title: windowTitle, Width: 1440, Height: 900, IconId: 1, Center: true,
		},
	})
	if w == nil {
		log.Println("WebView2 not available")
		if msgBox("Für SP Tool wird die „Microsoft Edge WebView2 Runtime“ benötigt (bei Windows 10/11 normalerweise vorhanden).\n\nJetzt die kostenlose Microsoft-Downloadseite öffnen?", mbYesNo|mbIconQuest) == idYes {
			openInBrowser("https://developer.microsoft.com/microsoft-edge/webview2/#download")
		}
		return
	}
	defer w.Destroy()
	_, err := os.Stat(sessionMarker())
	lastRunCrashed = err == nil
	_ = os.WriteFile(sessionMarker(), nil, 0o644)
	styleWindow(uintptr(w.Window()))
	w.SetSize(1100, 700, webview2.HintMin)
	w.Navigate(url)
	w.Run() // returns when the window is closed
	_ = os.Remove(sessionMarker())
	log.Println("window closed")
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

func handler(port int) http.Handler {
	sub, _ := fs.Sub(webFS, "web")
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
	_ = mime.AddExtensionType(".js", "text/javascript; charset=utf-8")
	_ = mime.AddExtensionType(".ogg", "audio/ogg") // bundled Turbo sounds
	_ = mime.AddExtensionType(".wav", "audio/wav") // bundled free reloads (CC0)
	allowed := map[string]bool{fmt.Sprintf("localhost:%d", port): true, fmt.Sprintf("127.0.0.1:%d", port): true}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only our own window: blocks DNS rebinding and other local pages.
		lastBeat.Store(time.Now().UnixNano())
		if !allowed[r.Host] {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if strings.HasPrefix(r.URL.Path, "/native/") {
			// Custom header = browsers block cross-site calls (no CORS answer is ever sent).
			if r.Header.Get("X-SPTool-Native") != "1" {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			native(w, r)
			return
		}
		p := path.Clean(r.URL.Path)
		if p == "/" {
			p = "/index.html"
		}
		data, err := fs.ReadFile(sub, strings.TrimPrefix(p, "/"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if ct := mime.TypeByExtension(path.Ext(p)); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(data)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

func native(w http.ResponseWriter, r *http.Request) {
	if installAPI(w, r) || appPackageAPI(w, r) || updateAPI(w, r) || baseAPI(w, r) || downloadsAPI(w, r) || gtaAPI(w, r) {
		return
	}
	switch r.URL.Path {
	case "/native/heartbeat":
		lastBeat.Store(time.Now().UnixNano())
		w.WriteHeader(http.StatusNoContent)
	case "/native/info":
		id, src := machineID()
		host, _ := os.Hostname()
		writeJSON(w, map[string]any{"version": version, "platform": "windows", "machineId": id, "machineIdSource": src, "hostName": host, "dataDir": dataDir, "lastRunCrashed": lastRunCrashed})
	case "/native/detect/fivem":
		writeJSON(w, detectFiveM(r.URL.Query().Get("customRoot")))
	case "/native/open":
		// Opens links (Discord sign-in, help pages) in the user's normal browser. https only.
		var body struct {
			URL string `json:"url"`
		}
		if r.Method != http.MethodPost || json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&body) != nil || !strings.HasPrefix(body.URL, "https://") {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		openInBrowser(body.URL)
		w.WriteHeader(http.StatusNoContent)
	case "/native/detect/gta":
		writeJSON(w, detectGta(r.URL.Query().Get("customPath")))
	default:
		http.NotFound(w, r)
	}
}

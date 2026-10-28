//go:build windows

// Machine id and FiveM / GTA V detection (port of src-tauri/src/detect.rs and device.rs).
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const keyWow64_64 = 0x0100

func regString(root syscall.Handle, key, name string, wow64 bool) string {
	k, _ := syscall.UTF16PtrFromString(key)
	access := uint32(syscall.KEY_READ)
	if wow64 {
		access |= keyWow64_64
	}
	var h syscall.Handle
	if syscall.RegOpenKeyEx(root, k, 0, access, &h) != nil {
		return ""
	}
	defer syscall.RegCloseKey(h)
	n, _ := syscall.UTF16PtrFromString(name)
	var typ, size uint32
	if syscall.RegQueryValueEx(h, n, nil, &typ, nil, &size) != nil || size == 0 {
		return ""
	}
	buf := make([]uint16, size/2+1)
	if syscall.RegQueryValueEx(h, n, nil, &typ, (*byte)(unsafe.Pointer(&buf[0])), &size) != nil {
		return ""
	}
	return syscall.UTF16ToString(buf)
}

// machineID: Windows MachineGuid (set at OS install). The app hashes it, the license server hashes
// it again – the raw value never leaves this PC.
func machineID() (string, string) {
	if g := strings.ToLower(strings.TrimSpace(regString(syscall.HKEY_LOCAL_MACHINE, `SOFTWARE\Microsoft\Cryptography`, "MachineGuid", true))); g != "" {
		return g, "windows-machine-guid"
	}
	f := filepath.Join(dataDir, "device.id")
	if b, err := os.ReadFile(f); err == nil && len(strings.TrimSpace(string(b))) >= 32 {
		return strings.TrimSpace(string(b)), "app-generated"
	}
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)
	_ = os.WriteFile(f, []byte(id), 0o600)
	return id, "app-generated"
}

type FiveMStatus struct {
	Detected          bool     `json:"detected"`
	Root              *string  `json:"root"`
	AppDir            *string  `json:"appDir"`
	ConfiguredGtaPath *string  `json:"configuredGtaPath"`
	Running           bool     `json:"running"`
	Checked           []string `json:"checked"`
}

type GtaInstall struct {
	Source  string `json:"source"`
	Path    string `json:"path"`
	Valid   bool   `json:"valid"`
	Edition string `json:"edition"`
}

func isDir(p string) bool  { st, err := os.Stat(p); return err == nil && st.IsDir() }
func isFile(p string) bool { st, err := os.Stat(p); return err == nil && !st.IsDir() }

func readIVPath(root string) *string {
	b, err := os.ReadFile(filepath.Join(root, "CitizenFX.ini"))
	if err != nil {
		return nil
	}
	for _, l := range strings.Split(string(b), "\n") {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "IVPath=") {
			v := strings.TrimSpace(strings.TrimPrefix(l, "IVPath="))
			return &v
		}
	}
	return nil
}

func fivemRunning() bool {
	out, err := hidden("tasklist", "/FO", "CSV", "/NH").Output()
	if err != nil {
		return false
	}
	for _, l := range strings.Split(strings.ToLower(string(out)), "\n") {
		if strings.HasPrefix(strings.TrimSpace(l), `"fivem`) {
			return true
		}
	}
	return false
}

func detectFiveM(custom string) FiveMStatus {
	st := FiveMStatus{Checked: []string{}}
	var cands []string
	if custom != "" {
		cands = append(cands, custom)
	}
	cands = append(cands, filepath.Join(localAppData(), "FiveM"))
	for _, d := range []string{"C", "D", "E", "F"} {
		cands = append(cands, d+`:\FiveM`, d+`:\Games\FiveM`)
	}
	for _, root := range cands {
		st.Checked = append(st.Checked, root)
		app := filepath.Join(root, "FiveM.app")
		if isDir(app) {
			r, a := root, app
			st.Detected, st.Root, st.AppDir = true, &r, &a
			st.ConfiguredGtaPath = readIVPath(root)
			break
		}
	}
	st.Running = fivemRunning()
	return st
}

func makeInstall(source, p string) GtaInstall {
	legacy, enhanced := isFile(filepath.Join(p, "GTA5.exe")), isFile(filepath.Join(p, "GTA5_Enhanced.exe"))
	ed := "Unknown"
	if legacy {
		ed = "Legacy"
	} else if enhanced {
		ed = "Enhanced"
	}
	return GtaInstall{Source: source, Path: p, Valid: legacy || enhanced, Edition: ed}
}

func steamLibraries(steam string) []string {
	libs := []string{steam}
	b, err := os.ReadFile(filepath.Join(steam, "steamapps", "libraryfolders.vdf"))
	if err != nil {
		return libs
	}
	for _, l := range strings.Split(string(b), "\n") {
		t := strings.TrimSpace(l)
		if strings.HasPrefix(t, `"path"`) {
			p := strings.Trim(strings.TrimSpace(strings.TrimPrefix(t, `"path"`)), `"`)
			p = strings.ReplaceAll(p, `\\`, `\`)
			if p != "" {
				libs = append(libs, p)
			}
		}
	}
	return libs
}

func detectGta(custom string) []GtaInstall {
	found := []GtaInstall{}
	push := func(src, p string) {
		for _, f := range found {
			if strings.EqualFold(f.Path, p) {
				return
			}
		}
		found = append(found, makeInstall(src, p))
	}
	if custom != "" {
		push("Custom", custom)
	}
	if p := regString(syscall.HKEY_LOCAL_MACHINE, `SOFTWARE\WOW6432Node\Rockstar Games\Grand Theft Auto V`, "InstallFolder", false); p != "" {
		push("Rockstar", p)
	}
	if steam := regString(syscall.HKEY_CURRENT_USER, `Software\Valve\Steam`, "SteamPath", false); steam != "" {
		for _, lib := range steamLibraries(strings.ReplaceAll(steam, "/", `\`)) {
			for _, name := range []string{"Grand Theft Auto V", "Grand Theft Auto V Legacy", "Grand Theft Auto V Enhanced"} {
				if p := filepath.Join(lib, "steamapps", "common", name); isDir(p) {
					push("Steam", p)
				}
			}
		}
	}
	if entries, err := os.ReadDir(`C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests`); err == nil {
		for _, e := range entries {
			if !strings.HasSuffix(strings.ToLower(e.Name()), ".item") {
				continue
			}
			b, err := os.ReadFile(filepath.Join(`C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests`, e.Name()))
			if err != nil {
				continue
			}
			var v struct{ DisplayName, InstallLocation string }
			if json.Unmarshal(b, &v) == nil && strings.Contains(v.DisplayName, "Grand Theft Auto V") && v.InstallLocation != "" {
				push("Epic Games", v.InstallLocation)
			}
		}
	}
	if p := readIVPath(filepath.Join(localAppData(), "FiveM")); p != nil {
		push("FiveM config", *p)
	}
	return found
}

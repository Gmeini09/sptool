//go:build windows

package main

// POST /native/downloads/save?folder=&file=   body = the archive; writes Downloads\SP Tool\<file> for a ZIP
//                                             (<name>.zip), or Downloads\SP Tool\<folder>\<file> for
//                                             WEAPONS_PLAYER.rpf / RESIDENT.rpf (older app builds); answers {path, dir}
// POST /native/downloads/show?folder=         opens that folder in Explorer
// Only ever writes below Downloads\SP Tool – names are sanitised, nothing else on the PC can be touched.

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const maxArchive = 600 << 20

func downloadsRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Downloads", "SP Tool"), nil
}

// safeFolder turns a pack name into a plain folder name ("Gambo Pack" stays, "..\x" → "x").
func safeFolder(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r < 32 || strings.ContainsRune(`<>:"/\|?*`, r):
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	s := strings.Trim(strings.TrimSpace(b.String()), ". ")
	if s == "" {
		s = "Soundpack"
	}
	if len(s) > 80 {
		s = s[:80]
	}
	return s
}

func downloadsAPI(w http.ResponseWriter, r *http.Request) bool {
	switch r.URL.Path {
	case "/native/downloads/save":
		if r.Method != http.MethodPost {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return true
		}
		file := r.URL.Query().Get("file")
		isZip := strings.HasSuffix(strings.ToLower(file), ".zip")
		if isZip {
			file = safeFolder(file[:len(file)-4]) + ".zip"
		} else if file != "WEAPONS_PLAYER.rpf" && file != "RESIDENT.rpf" {
			http.Error(w, "unbekannte Datei", http.StatusBadRequest)
			return true
		}
		root, err := downloadsRoot()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return true
		}
		dir := root
		if !isZip {
			dir = filepath.Join(root, safeFolder(r.URL.Query().Get("folder")))
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			http.Error(w, "Ordner konnte nicht angelegt werden: "+err.Error(), http.StatusInternalServerError)
			return true
		}
		target := filepath.Join(dir, file)
		tmp := target + ".part"
		f, err := os.Create(tmp)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return true
		}
		_, cerr := io.Copy(f, io.LimitReader(r.Body, maxArchive))
		if err := f.Close(); cerr == nil {
			cerr = err
		}
		if cerr == nil {
			_ = os.Remove(target)
			cerr = os.Rename(tmp, target)
		}
		if cerr != nil {
			_ = os.Remove(tmp)
			http.Error(w, "Speichern fehlgeschlagen: "+cerr.Error(), http.StatusInternalServerError)
			return true
		}
		writeJSON(w, map[string]string{"path": target, "dir": dir})
		return true
	case "/native/downloads/show":
		root, err := downloadsRoot()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return true
		}
		dir := root
		if f := r.URL.Query().Get("folder"); f != "" {
			dir = filepath.Join(root, safeFolder(f))
		}
		if _, err := os.Stat(dir); err != nil {
			http.Error(w, "Ordner nicht gefunden", http.StatusNotFound)
			return true
		}
		openFolder(dir)
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

// openFolder shows a folder in Explorer.
func openFolder(dir string) {
	verb, _ := syscall.UTF16PtrFromString("open")
	target, _ := syscall.UTF16PtrFromString(dir)
	pShellExecute.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(target)), 0, 0, 1)
}

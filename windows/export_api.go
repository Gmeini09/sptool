//go:build windows

package main

// Export of a finished soundpack into a folder the user picks (any folder; the user copies the files into GTA's sfx folder himself):
//
//	POST /native/export/pick?initial=…       Windows folder dialog → {folder} ("" when cancelled)
//	POST /native/export/save?folder=…&file=… body = WEAPONS_PLAYER.rpf / RESIDENT.rpf → written directly into the folder
//	POST /native/export/show?folder=…        opens the folder in Explorer
//
// Only these two archive names are written, nothing else. Never into a GTA V installation (a folder with GTA5.exe or
// one of its subfolders) – the game's own files stay untouched; the user copies the pack there himself if he wants.

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

var exportFiles = map[string]bool{"WEAPONS_PLAYER.rpf": true, "RESIDENT.rpf": true}

// insideGta: true when dir is a GTA V installation or lies inside one.
func insideGta(dir string) bool {
	for d := filepath.Clean(dir); ; {
		for _, exe := range []string{"GTA5.exe", "GTA5_Enhanced.exe", "PlayGTAV.exe"} {
			if _, err := os.Stat(filepath.Join(d, exe)); err == nil {
				return true
			}
		}
		parent := filepath.Dir(d)
		if parent == d {
			return false
		}
		d = parent
	}
}

func checkExportFolder(folder string) (string, error) {
	if folder == "" || !filepath.IsAbs(folder) {
		return "", errors.New("Bitte einen Ordner wählen.")
	}
	folder = filepath.Clean(folder)
	if insideGta(folder) {
		return "", errors.New("Das ist der GTA-V-Ordner. SP Tool schreibt nie in die Spieldateien – wähl einen anderen Ordner (z. B. einen Ordner auf dem Desktop) und kopier die Dateien danach selbst in den sfx-Ordner.")
	}
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return "", errors.New("Ordner konnte nicht angelegt werden: " + err.Error())
	}
	return folder, nil
}

// pickFolder shows Windows' Explorer-style folder dialog (folderdialog.go), owned by the SP Tool window.
func pickFolder(initial string) (string, error) {
	return pickFolderNative("Ordner für deinen Soundpack wählen", "Ordner wählen", initial)
}

func exportAPI(w http.ResponseWriter, r *http.Request) bool {
	if !strings.HasPrefix(r.URL.Path, "/native/export/") {
		return false
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return true
	}
	q := r.URL.Query()
	switch r.URL.Path {
	case "/native/export/pick":
		folder, err := pickFolder(q.Get("initial"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return true
		}
		if folder != "" && insideGta(folder) {
			http.Error(w, "Das ist der GTA-V-Ordner. SP Tool schreibt nie in die Spieldateien – wähl einen anderen Ordner (z. B. einen Ordner auf dem Desktop) und kopier die Dateien danach selbst in den sfx-Ordner.", http.StatusBadRequest)
			return true
		}
		writeJSON(w, map[string]string{"folder": folder})
	case "/native/export/save":
		file := q.Get("file")
		if !exportFiles[file] {
			http.Error(w, "unbekannte Datei", http.StatusBadRequest)
			return true
		}
		folder, err := checkExportFolder(q.Get("folder"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return true
		}
		target := filepath.Join(folder, file)
		tmp := target + ".part"
		f, err := os.Create(tmp)
		if err != nil {
			http.Error(w, "Speichern fehlgeschlagen: "+err.Error(), http.StatusInternalServerError)
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
		writeJSON(w, map[string]string{"path": target, "dir": folder})
	case "/native/export/show":
		folder := filepath.Clean(q.Get("folder"))
		if st, err := os.Stat(folder); err != nil || !st.IsDir() {
			http.Error(w, "Ordner nicht gefunden", http.StatusNotFound)
			return true
		}
		openFolder(folder)
		w.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(w, r)
	}
	return true
}

package main

// GET /native/base/candidates   searches the PC for a working weapon soundpack (read-only, see package basefind)
// GET /native/base/file?id=&name=  the bytes of one archive of a found candidate (nothing else can be read)

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"

	"sptool/windows/basefind"
)

var (
	baseMu    sync.Mutex
	baseFound = map[string]basefind.Candidate{}
)

func baseRoots(r *http.Request) []basefind.Root {
	var roots []basefind.Root
	if st := detectFiveM(r.URL.Query().Get("root")); st.Detected && st.AppDir != nil {
		roots = append(roots, basefind.Root{Source: "FiveM-mods-Ordner", Dir: filepath.Join(*st.AppDir, "mods"), Depth: 3})
	}
	for _, g := range detectGta(r.URL.Query().Get("gta")) {
		roots = append(roots, basefind.Root{Source: "OpenIV-mods-Ordner (GTA V)", Dir: filepath.Join(g.Path, "mods", "x64", "audio", "sfx"), Depth: 0})
	}
	// FiveM's default folder also when FiveM was not detected (custom installs, detection failed)
	if la := os.Getenv("LOCALAPPDATA"); la != "" {
		roots = append(roots, basefind.Root{Source: "FiveM-mods-Ordner", Dir: filepath.Join(la, "FiveM", "FiveM.app", "mods"), Depth: 3})
	}
	if home, err := os.UserHomeDir(); err == nil {
		for _, d := range []struct{ name, label string }{
			{"Downloads", "Downloads"}, {filepath.Join("OneDrive", "Downloads"), "Downloads"},
			{"Desktop", "Desktop"}, {filepath.Join("OneDrive", "Desktop"), "Desktop"}, {filepath.Join("OneDrive", "Schreibtisch"), "Desktop"},
			{"Documents", "Dokumente"}, {filepath.Join("OneDrive", "Documents"), "Dokumente"}, {filepath.Join("OneDrive", "Dokumente"), "Dokumente"},
		} {
			roots = append(roots, basefind.Root{Source: d.label, Dir: filepath.Join(home, d.name), Depth: 5})
		}
	}
	return roots
}

func baseAPI(w http.ResponseWriter, r *http.Request) bool {
	switch r.URL.Path {
	case "/native/base/candidates":
		list := basefind.Search(baseRoots(r), 60000)
		baseMu.Lock()
		baseFound = map[string]basefind.Candidate{}
		for _, c := range list {
			baseFound[c.ID] = c
		}
		baseMu.Unlock()
		writeJSON(w, list)
		return true
	case "/native/base/file":
		baseMu.Lock()
		c, ok := baseFound[r.URL.Query().Get("id")]
		baseMu.Unlock()
		if !ok {
			http.Error(w, "unknown candidate", http.StatusNotFound)
			return true
		}
		b, err := basefind.Read(c, r.URL.Query().Get("name"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return true
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", strconv.Itoa(len(b)))
		_, _ = w.Write(b)
		return true
	}
	return false
}

package main

// /native/mods, /native/stage, /native/install, /native/backups… – the HTTP side of the installer.
// All file work happens in package installer (tested on any OS); this only adapts it to FiveM detection.

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"sptool/windows/installer"
)

func installManager(r *http.Request) *installer.Manager {
	root := r.URL.Query().Get("root")
	return &installer.Manager{
		DataDir: dataDir,
		ModsDir: func() (string, error) {
			st := detectFiveM(root)
			if !st.Detected || st.AppDir == nil || *st.AppDir == "" {
				return "", installer.ErrNoFiveM
			}
			return filepath.Join(*st.AppDir, "mods"), nil
		},
		Running: func() bool { return detectFiveM(root).Running },
	}
}

func apiError(w http.ResponseWriter, err error) {
	code := http.StatusInternalServerError
	switch {
	case errors.Is(err, installer.ErrRunning):
		code = http.StatusConflict
	case errors.Is(err, installer.ErrNoFiveM), errors.Is(err, installer.ErrNotFound):
		code = http.StatusNotFound
	case errors.Is(err, installer.ErrBadName), errors.Is(err, installer.ErrHash), errors.Is(err, installer.ErrNoFiles):
		code = http.StatusBadRequest
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

// installAPI handles the installer routes; returns false when the path is not one of them.
func installAPI(w http.ResponseWriter, r *http.Request) bool {
	p := r.URL.Path
	if strings.HasPrefix(p, "/native/sfx/") {
		return sfxAPI(w, r)
	}
	if !strings.HasPrefix(p, "/native/mods") && !strings.HasPrefix(p, "/native/stage") && !strings.HasPrefix(p, "/native/install") && !strings.HasPrefix(p, "/native/backups") {
		return false
	}
	m := installManager(r)
	post := r.Method == http.MethodPost
	switch {
	case p == "/native/mods" && r.Method == http.MethodGet:
		list, err := m.Mods()
		if err != nil {
			apiError(w, err)
			return true
		}
		writeJSON(w, list)
	case p == "/native/mods/scan" && r.Method == http.MethodGet:
		res, err := m.Scan()
		if err != nil {
			apiError(w, err)
			return true
		}
		writeJSON(w, res)
	case p == "/native/mods/show" && post:
		dir, err := m.ModsDir()
		if err != nil {
			apiError(w, err)
			return true
		}
		_ = os.MkdirAll(dir, 0o755)
		openFolder(dir)
		w.WriteHeader(http.StatusNoContent)
	case p == "/native/mods/file" && r.Method == http.MethodGet:
		f, size, err := m.OpenMod(r.URL.Query().Get("name"))
		if err != nil {
			apiError(w, err)
			return true
		}
		defer f.Close()
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
		w.Header().Set("Cache-Control", "no-store")
		_, _ = io.Copy(w, f)
	case p == "/native/stage/session" && post:
		writeJSON(w, map[string]string{"session": installer.NewSession()})
	case p == "/native/stage" && post:
		q := r.URL.Query()
		sum, size, err := m.Stage(q.Get("session"), q.Get("name"), r.Body)
		if err != nil {
			apiError(w, err)
			return true
		}
		writeJSON(w, map[string]any{"sha256": sum, "size": size})
	case p == "/native/stage/discard" && post:
		m.DiscardSession(r.URL.Query().Get("session"))
		w.WriteHeader(http.StatusNoContent)
	case p == "/native/install" && post:
		var body struct {
			Session string              `json:"session"`
			Pack    string              `json:"pack"`
			Version string              `json:"version"`
			Files   []installer.FileRef `json:"files"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body) != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return true
		}
		b, err := m.Install(body.Session, trim(body.Pack, 80), trim(body.Version, 20), body.Files)
		if err != nil {
			apiError(w, err)
			return true
		}
		writeJSON(w, b)
	case p == "/native/backups" && r.Method == http.MethodGet:
		list, err := m.List()
		if err != nil {
			apiError(w, err)
			return true
		}
		writeJSON(w, list)
	case (p == "/native/backups/restore" || p == "/native/backups/delete") && post:
		var body struct{ ID string `json:"id"` }
		if json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body) != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return true
		}
		if p == "/native/backups/delete" {
			if err := m.Delete(body.ID); err != nil {
				apiError(w, err)
				return true
			}
			w.WriteHeader(http.StatusNoContent)
			return true
		}
		safety, err := m.Restore(body.ID)
		if err != nil {
			apiError(w, err)
			return true
		}
		writeJSON(w, safety)
	default:
		http.NotFound(w, r)
	}
	return true
}

func trim(s string, n int) string {
	s = strings.TrimSpace(s)
	if len([]rune(s)) > n {
		return string([]rune(s)[:n])
	}
	return s
}

// sfxDir: GTA V\x64\audio\sfx – where the user puts WEAPONS_PLAYER.rpf / RESIDENT.rpf himself. The GTA folder set in
// SP Tool wins, then the one FiveM uses, then the first detected install.
func sfxDir(r *http.Request) (string, error) {
	q := r.URL.Query()
	var cands []string
	if g := strings.TrimSpace(q.Get("gta")); g != "" {
		cands = append(cands, g)
	}
	if st := detectFiveM(q.Get("root")); st.ConfiguredGtaPath != nil && *st.ConfiguredGtaPath != "" {
		cands = append(cands, *st.ConfiguredGtaPath)
	}
	for _, g := range detectGta("") {
		if g.Valid {
			cands = append(cands, g.Path)
		}
	}
	for _, c := range cands {
		d := filepath.Join(c, "x64", "audio", "sfx")
		if isDir(d) {
			return d, nil
		}
	}
	return "", errNoGta
}

var errNoGta = errors.New("GTA V was not found")

// /native/sfx/scan (read only: which WEAPONS_PLAYER / RESIDENT lie there) · /native/sfx/show (opens the folder)
func sfxAPI(w http.ResponseWriter, r *http.Request) bool {
	dir, err := sfxDir(r)
	if err != nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "gta_not_found"})
		return true
	}
	m := &installer.Manager{DataDir: dataDir, ModsDir: func() (string, error) { return dir, nil }, Running: func() bool { return detectFiveM(r.URL.Query().Get("root")).Running }}
	switch {
	case r.URL.Path == "/native/sfx/scan" && r.Method == http.MethodGet:
		res, err := m.Scan()
		if err != nil {
			apiError(w, err)
			return true
		}
		writeJSON(w, res)
	case r.URL.Path == "/native/sfx/show" && r.Method == http.MethodPost:
		openFolder(dir)
		w.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(w, r)
	}
	return true
}

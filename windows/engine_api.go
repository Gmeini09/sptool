//go:build windows

package main

// Soundpack-Engine (C#, engine/ im Repo) – baut die Soundpacks in der Windows-App.
//
//	GET  /native/sp/status          {available, gta, offline, haveKeys, haveOriginals} – Engine da? GTA da? ohne GTA bereit?
//	POST /native/sp/import?name=…   Rohdaten einer Datei (GTA5.exe, WEAPONS_PLAYER.rpf/RESIDENT.rpf oder ZIP) → Engine-Ergebnis
//	                                Einmal-Import für den Betrieb ohne GTA: Schlüssel und geprüfte Originale bleiben lokal.
//	POST /native/sp/build           {packName, encryption, gta?, streams?, sounds:[{weapon, slot, wav(base64)}]} → {job}
//	                                ohne GTA-Ordner: mit den importierten Originalen und streams (SP Tools Zuordnung)
//	POST /native/sp/plan            wie build, aber nur planen (welche Spieldatei-Einträge ersetzt/stumm würden) → {job}
//	GET  /native/sp/job?id=…        {done, progress, log, result}
//	GET  /native/sp/file?id=…&name=… eine Ausgabedatei des Jobs (nur Dateien aus dessen Ergebnis)
//
// Die Engine wird beim ersten Gebrauch aus der eingebetteten spengine.zip nach %LOCALAPPDATA%\SPTool\engine\<hash>
// entpackt. Sie liest den GTA-Ordner nur und schreibt nur in den Job-Ordner unter %LOCALAPPDATA%\SPTool\spjobs.

import (
	"archive/zip"
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed all:engine
var engineFS embed.FS

type spSound struct {
	Weapon string `json:"weapon"`
	Slot   string `json:"slot"`
	Wav    string `json:"wav"` // base64
}

type spRequest struct {
	PackName   string    `json:"packName"`
	Encryption string    `json:"encryption"`
	Gta        string    `json:"gta"`
	Sounds     []spSound `json:"sounds"`
	// "WEAPON_PISTOL/fire" → Stream-IDs; nur ohne GTA-Ordner benutzt
	Streams map[string][]uint32 `json:"streams"`
}

// engineStatus: can the engine build without GTA (keys + originals imported once)?
type engineStatus struct {
	HaveKeys      bool `json:"haveKeys"`
	HaveOriginals bool `json:"haveOriginals"`
}

func runEngineSync(exe string, timeout time.Duration, args ...string) (json.RawMessage, error) {
	cmd := hidden(exe, args...)
	cmd.Dir = filepath.Dir(exe)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(timeout):
		_ = cmd.Process.Kill()
		return nil, errors.New("Die Soundpack-Engine antwortet nicht.")
	}
	out := bytes.TrimSpace(stdout.Bytes())
	if len(out) == 0 || !json.Valid(out) {
		return nil, errors.New("Die Soundpack-Engine hat keine Antwort geliefert.")
	}
	return out, nil
}

func offlineStatus() engineStatus {
	var st engineStatus
	exe, err := ensureEngine()
	if err != nil {
		return st
	}
	if out, err := runEngineSync(exe, time.Minute, "status"); err == nil {
		_ = json.Unmarshal(out, &st)
	}
	return st
}

// importFile: one file from the UI (raw body) → spengine import → its result.
func importFile(w http.ResponseWriter, r *http.Request) {
	exe, err := ensureEngine()
	if err != nil {
		apiError(w, err)
		return
	}
	name := filepath.Base(strings.ReplaceAll(r.URL.Query().Get("name"), "\\", "/"))
	if name == "" || name == "." || name == "/" {
		http.Error(w, "name fehlt", http.StatusBadRequest)
		return
	}
	dir := filepath.Join(dataDir, "spimport", newJobID())
	if err := os.MkdirAll(dir, 0o755); err != nil {
		apiError(w, err)
		return
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	if err != nil {
		apiError(w, err)
		return
	}
	_, err = io.Copy(f, io.LimitReader(r.Body, 2<<30))
	f.Close()
	if err != nil {
		apiError(w, err)
		return
	}
	reqPath := filepath.Join(dir, "request.json")
	b, _ := json.Marshal(map[string]any{"files": []string{path}})
	if err := os.WriteFile(reqPath, b, 0o644); err != nil {
		apiError(w, err)
		return
	}
	out, err := runEngineSync(exe, 10*time.Minute, "import", reqPath)
	if err != nil {
		out = errResult(err)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(out)
}

type spOutput struct {
	Name         string `json:"name"`
	RelativePath string `json:"relativePath"`
	Path         string `json:"path"`
	Size         int64  `json:"size"`
	Changed      bool   `json:"changed"`
}

type spJob struct {
	mu       sync.Mutex
	id       string
	dir      string
	done     bool
	progress string
	log      []string
	result   json.RawMessage
	outputs  []spOutput
}

var (
	spJobs   = map[string]*spJob{}
	spJobsMu sync.Mutex
	spExeMu  sync.Mutex
	spExe    string
)

// engineZip: the embedded engine, nil when this SPTool.exe was built without it.
func engineZip() []byte {
	b, err := fs.ReadFile(engineFS, "engine/spengine.zip")
	if err != nil || len(b) == 0 {
		return nil
	}
	return b
}

// ensureEngine unpacks the engine once per version and returns the path to spengine.exe.
func ensureEngine() (string, error) {
	spExeMu.Lock()
	defer spExeMu.Unlock()
	if spExe != "" {
		if _, err := os.Stat(spExe); err == nil {
			return spExe, nil
		}
	}
	z := engineZip()
	if z == nil {
		return "", errors.New("engine_missing")
	}
	sum := sha256.Sum256(z)
	dir := filepath.Join(dataDir, "engine", hex.EncodeToString(sum[:])[:16])
	exe := filepath.Join(dir, "spengine.exe")
	if _, err := os.Stat(filepath.Join(dir, ".complete")); err == nil {
		spExe = exe
		return exe, nil
	}
	_ = os.RemoveAll(dir)
	zr, err := zip.NewReader(bytes.NewReader(z), int64(len(z)))
	if err != nil {
		return "", err
	}
	for _, f := range zr.File {
		dest := filepath.Join(dir, filepath.FromSlash(f.Name))
		if !strings.HasPrefix(dest, dir+string(os.PathSeparator)) {
			return "", fmt.Errorf("bad path in engine zip: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			_ = os.MkdirAll(dest, 0o755)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return "", err
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		out, err := os.Create(dest)
		if err != nil {
			rc.Close()
			return "", err
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		out.Close()
		if err != nil {
			return "", err
		}
	}
	if _, err := os.Stat(exe); err != nil {
		return "", errors.New("spengine.exe fehlt in der Engine")
	}
	_ = os.WriteFile(filepath.Join(dir, ".complete"), nil, 0o644)
	spExe = exe
	return exe, nil
}

// spGtaFolder: the first GTA V folder with a GTA5.exe (the user's choice first, then detected installs).
func spGtaFolder(r *http.Request, preferred string) string {
	dirs := gtaDirs(r)
	if preferred != "" {
		dirs = append([]string{preferred}, dirs...)
	}
	for _, d := range dirs {
		for _, exe := range []string{"GTA5.exe", "GTA5_Enhanced.exe"} {
			if _, err := os.Stat(filepath.Join(d, exe)); err == nil {
				return d
			}
		}
	}
	return ""
}

func newJobID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// cleanOldJobs removes job folders older than a day (the RPF copies are large).
func cleanOldJobs() {
	root := filepath.Join(dataDir, "spjobs")
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, e := range entries {
		if info, err := e.Info(); err == nil && time.Since(info.ModTime()) > 24*time.Hour {
			_ = os.RemoveAll(filepath.Join(root, e.Name()))
		}
	}
}

func startEngineJob(w http.ResponseWriter, r *http.Request, command string) {
	var req spRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 512<<20)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	exe, err := ensureEngine()
	if err != nil {
		apiError(w, err)
		return
	}
	gta := spGtaFolder(r, req.Gta)
	if gta == "" {
		// ohne GTA: nur mit einmal importierten Originalen + Schlüssel
		if st := offlineStatus(); !st.HaveKeys || !st.HaveOriginals {
			apiError(w, errors.New("gta_not_found: Kein GTA V auf diesem PC. Zum Erstellen ohne GTA einmal die Original-Dateien (WEAPONS_PLAYER.rpf + RESIDENT.rpf, z. B. „Original GTA V Soundpack“) und eine GTA5.exe von GTA V Legacy importieren."))
			return
		}
	}
	cleanOldJobs()
	job := &spJob{id: newJobID()}
	job.dir = filepath.Join(dataDir, "spjobs", job.id)
	if err := os.MkdirAll(job.dir, 0o755); err != nil {
		apiError(w, err)
		return
	}
	type engineSound struct {
		Weapon string `json:"weapon"`
		Slot   string `json:"slot"`
		File   string `json:"file"`
	}
	sounds := []engineSound{}
	for i, s := range req.Sounds {
		data, err := base64.StdEncoding.DecodeString(s.Wav)
		if err != nil || len(data) < 44 {
			http.Error(w, "bad wav", http.StatusBadRequest)
			return
		}
		name := fmt.Sprintf("sound_%02d.wav", i)
		if err := os.WriteFile(filepath.Join(job.dir, name), data, 0o644); err != nil {
			apiError(w, err)
			return
		}
		sounds = append(sounds, engineSound{Weapon: s.Weapon, Slot: s.Slot, File: name})
	}
	enc := req.Encryption
	if enc == "" {
		enc = "ng"
	}
	engineReq := map[string]any{
		"gtaFolder":       gta,
		"workDir":         job.dir,
		"packName":        req.PackName,
		"encryption":      enc,
		"includeArchives": []string{`x64\audio\sfx\WEAPONS_PLAYER.rpf`, `x64\audio\sfx\RESIDENT.rpf`},
		"sounds":          sounds,
		"streams":         req.Streams,
	}
	reqPath := filepath.Join(job.dir, "request.json")
	b, _ := json.Marshal(engineReq)
	if err := os.WriteFile(reqPath, b, 0o644); err != nil {
		apiError(w, err)
		return
	}
	spJobsMu.Lock()
	spJobs[job.id] = job
	spJobsMu.Unlock()

	go runEngineJob(job, exe, command, reqPath)
	writeJSON(w, map[string]string{"job": job.id})
}

func runEngineJob(job *spJob, exe, command, reqPath string) {
	finish := func(result json.RawMessage) {
		job.mu.Lock()
		job.result = result
		job.done = true
		var parsed struct {
			Outputs []spOutput `json:"outputs"`
		}
		if json.Unmarshal(result, &parsed) == nil {
			job.outputs = parsed.Outputs
		}
		job.mu.Unlock()
	}
	cmd := hidden(exe, command, reqPath)
	cmd.Dir = filepath.Dir(exe)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	stderr, err := cmd.StderrPipe()
	if err != nil {
		finish(errResult(err))
		return
	}
	if err := cmd.Start(); err != nil {
		finish(errResult(err))
		return
	}
	sc := bufio.NewScanner(stderr)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		job.mu.Lock()
		if strings.HasPrefix(line, "PROGRESS ") {
			job.progress = strings.TrimPrefix(line, "PROGRESS ")
		}
		if line != "" && len(job.log) < 2000 {
			job.log = append(job.log, line)
		}
		job.mu.Unlock()
	}
	_ = cmd.Wait()
	out := bytes.TrimSpace(stdout.Bytes())
	if len(out) == 0 || !json.Valid(out) {
		finish(errResult(errors.New("Die Soundpack-Engine hat keine Antwort geliefert (siehe Protokoll).")))
		return
	}
	finish(json.RawMessage(out))
}

func errResult(err error) json.RawMessage {
	b, _ := json.Marshal(map[string]any{"ok": false, "error": err.Error()})
	return b
}

func engineAPI(w http.ResponseWriter, r *http.Request) bool {
	if !strings.HasPrefix(r.URL.Path, "/native/sp/") {
		return false
	}
	switch {
	case r.URL.Path == "/native/sp/status" && r.Method == http.MethodGet:
		resp := map[string]any{"available": engineZip() != nil, "gta": spGtaFolder(r, r.URL.Query().Get("gta"))}
		if engineZip() != nil {
			st := offlineStatus()
			resp["haveKeys"], resp["haveOriginals"], resp["offline"] = st.HaveKeys, st.HaveOriginals, st.HaveKeys && st.HaveOriginals
		}
		writeJSON(w, resp)
	case r.URL.Path == "/native/sp/import" && r.Method == http.MethodPost:
		importFile(w, r)
	case (r.URL.Path == "/native/sp/build" || r.URL.Path == "/native/sp/plan") && r.Method == http.MethodPost:
		startEngineJob(w, r, strings.TrimPrefix(r.URL.Path, "/native/sp/"))
	case r.URL.Path == "/native/sp/job" && r.Method == http.MethodGet:
		spJobsMu.Lock()
		job := spJobs[r.URL.Query().Get("id")]
		spJobsMu.Unlock()
		if job == nil {
			http.NotFound(w, r)
			return true
		}
		job.mu.Lock()
		resp := map[string]any{"done": job.done, "progress": job.progress, "log": job.log}
		if job.done {
			resp["result"] = job.result
		}
		job.mu.Unlock()
		writeJSON(w, resp)
	case r.URL.Path == "/native/sp/file" && r.Method == http.MethodGet:
		spJobsMu.Lock()
		job := spJobs[r.URL.Query().Get("id")]
		spJobsMu.Unlock()
		if job == nil {
			http.NotFound(w, r)
			return true
		}
		name := r.URL.Query().Get("name")
		job.mu.Lock()
		var path string
		for _, o := range job.outputs {
			// only files the engine reported, and only inside this job's folder
			if strings.EqualFold(o.RelativePath, name) && strings.HasPrefix(strings.ToLower(o.Path), strings.ToLower(job.dir)+string(os.PathSeparator)) {
				path = o.Path
			}
		}
		job.mu.Unlock()
		if path == "" {
			http.NotFound(w, r)
			return true
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, path)
	default:
		http.NotFound(w, r)
	}
	return true
}

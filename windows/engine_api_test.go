//go:build windows

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The embedded engine unpacks and answers with JSON – also for a folder without GTA V (clean error, no crash).
// Skipped when this build has no engine (windows/engine/spengine.zip is made by scripts/build-windows.mjs).
func TestEngineUnpacksAndAnswers(t *testing.T) {
	if engineZip() == nil {
		t.Skip("no embedded engine in this build")
	}
	old := dataDir
	dataDir = t.TempDir()
	defer func() { dataDir = old; spExe = "" }()

	exe, err := ensureEngine()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(exe), "strings.txt")); err != nil {
		t.Errorf("strings.txt missing next to spengine.exe: %v", err)
	}
	again, err := ensureEngine()
	if err != nil || again != exe {
		t.Fatalf("second ensureEngine: %v %q", err, again)
	}

	job := &spJob{id: "test", dir: t.TempDir()}
	req := filepath.Join(job.dir, "request.json")
	b, _ := json.Marshal(map[string]any{"gtaFolder": job.dir, "workDir": job.dir, "sounds": []any{}})
	if err := os.WriteFile(req, b, 0o644); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { runEngineJob(job, exe, "plan", req); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Minute):
		t.Fatal("engine did not finish")
	}
	var res struct {
		Ok    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(job.result, &res); err != nil {
		t.Fatalf("no JSON from engine: %v (%s)", err, job.result)
	}
	if res.Ok || res.Error == "" {
		t.Fatalf("expected a clean error for a folder without GTA5.exe, got %s", job.result)
	}
	t.Logf("engine says: %s", res.Error)
}

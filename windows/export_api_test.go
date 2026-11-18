//go:build windows

package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExportWritesOnlyIntoChosenFolderNeverIntoGta(t *testing.T) {
	root := t.TempDir()
	out := filepath.Join(root, "FiveM.app", "mods")
	save := func(folder, file string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/native/export/save?folder="+url.QueryEscape(folder)+"&file="+url.QueryEscape(file), strings.NewReader("RPF7data"))
		w := httptest.NewRecorder()
		exportAPI(w, req)
		return w
	}

	if w := save(out, "WEAPONS_PLAYER.rpf"); w.Code != http.StatusOK {
		t.Fatalf("save: %d %s", w.Code, w.Body.String())
	}
	if b, err := os.ReadFile(filepath.Join(out, "WEAPONS_PLAYER.rpf")); err != nil || string(b) != "RPF7data" {
		t.Fatalf("file not written: %v %q", err, b)
	}
	if w := save(out, "..\\evil.exe"); w.Code != http.StatusBadRequest {
		t.Errorf("other file names must be refused, got %d", w.Code)
	}
	if w := save("relative\\dir", "RESIDENT.rpf"); w.Code != http.StatusBadRequest {
		t.Errorf("relative folders must be refused, got %d", w.Code)
	}

	gta := filepath.Join(root, "Grand Theft Auto V")
	sfx := filepath.Join(gta, "x64", "audio", "sfx")
	_ = os.MkdirAll(sfx, 0o755)
	_ = os.WriteFile(filepath.Join(gta, "GTA5.exe"), []byte("MZ"), 0o644)
	if w := save(sfx, "RESIDENT.rpf"); w.Code != http.StatusBadRequest {
		t.Errorf("GTA folder must be refused, got %d", w.Code)
	}
	if _, err := os.Stat(filepath.Join(sfx, "RESIDENT.rpf")); err == nil {
		t.Error("wrote into the GTA folder")
	}
}

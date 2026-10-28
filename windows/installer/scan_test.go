package installer

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScan(t *testing.T) {
	mods := t.TempDir()
	m := &Manager{DataDir: t.TempDir(), ModsDir: func() (string, error) { return mods, nil }, Running: func() bool { return true }}
	_ = os.WriteFile(filepath.Join(mods, "WEAPONS_PLAYER.rpf"), []byte("old"), 0o644)
	_ = os.WriteFile(filepath.Join(mods, "other.rpf"), []byte("x"), 0o644)
	_ = os.MkdirAll(filepath.Join(mods, "testest", "testest"), 0o755)
	_ = os.WriteFile(filepath.Join(mods, "testest", "testest", "RESIDENT.rpf"), []byte("new"), 0o644)
	_ = os.MkdirAll(filepath.Join(mods, "a", "b", "c", "d"), 0o755)
	_ = os.WriteFile(filepath.Join(mods, "a", "b", "c", "d", "RESIDENT.rpf"), []byte("deep"), 0o644)
	r, err := m.Scan()
	if err != nil || !r.Running {
		t.Fatal(err)
	}
	if len(r.Files) != 2 {
		t.Fatalf("files: %+v", r.Files)
	}
	got := map[string]int{}
	for _, f := range r.Files {
		got[f.Path] = f.Depth
	}
	if d, ok := got["WEAPONS_PLAYER.rpf"]; !ok || d != 0 {
		t.Errorf("top level: %+v", got)
	}
	if d, ok := got[`testest\testest\RESIDENT.rpf`]; !ok || d != 2 {
		t.Errorf("subfolder: %+v", got)
	}
}

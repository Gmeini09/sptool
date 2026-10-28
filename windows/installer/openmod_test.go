package installer

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenMod(t *testing.T) {
	mods := t.TempDir()
	m := &Manager{DataDir: t.TempDir(), ModsDir: func() (string, error) { return mods, nil }}
	_ = os.WriteFile(filepath.Join(mods, "WEAPONS_PLAYER.rpf"), []byte("RPF7data"), 0o644)
	f, size, err := m.OpenMod("WEAPONS_PLAYER.rpf")
	if err != nil || size != 8 {
		t.Fatalf("open: %v %d", err, size)
	}
	f.Close()
	for _, bad := range []string{"../WEAPONS_PLAYER.rpf", "x/WEAPONS_PLAYER.rpf", "secret.txt", "CON.rpf"} {
		if _, _, err := m.OpenMod(bad); err != ErrBadName {
			t.Errorf("%q accepted: %v", bad, err)
		}
	}
	if _, _, err := m.OpenMod("RESIDENT.rpf"); err != ErrNotFound {
		t.Error("missing file not reported")
	}
}

package basefind

import (
	"archive/zip"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

const (
	encNG   = 0x0FEFFFFF // what real soundpacks carry (only the table of contents is encrypted)
	encOpen = 0x4E45504F
)

// rpf builds a tiny archive; withSounds puts an audio container ("ADAT") at offset 1024.
func rpf(enc uint32, withSounds bool) []byte {
	b := make([]byte, 2048)
	binary.LittleEndian.PutUint32(b, rpf7Magic)
	binary.LittleEndian.PutUint32(b[12:], enc)
	if withSounds {
		copy(b[1024:], "ADAT")
	} else {
		copy(b[1030:], "ADAT") // not on a 512-byte boundary → no container
	}
	return b
}

func TestCanonical(t *testing.T) {
	for in, want := range map[string]string{"WEAPONS_PLAYER.rpf": "WEAPONS_PLAYER.rpf", "weapons_player (2).rpf": "WEAPONS_PLAYER.rpf", "WEAPONS_PLAYER_5_7.rpf": "WEAPONS_PLAYER.rpf",
		"RESIDENT_9303d5.rpf": "RESIDENT.rpf", "pack/x64/resident.rpf": "RESIDENT.rpf", "weapons.rpf": "", "residential.rpf": "", "WEAPONS_PLAYER.zip": "",
		"Gambo-WEAPONS_PLAYER.rpf": "WEAPONS_PLAYER.rpf", "4d29eede-WEAPONS_PLAYER.rpf": "WEAPONS_PLAYER.rpf", "pack_resident.rpf": "RESIDENT.rpf"} {
		if got := Canonical(in); got != want {
			t.Errorf("%s: %q, want %q", in, got, want)
		}
	}
}

func TestSearchFindsReadablePacksOnly(t *testing.T) {
	root := t.TempDir()
	good := filepath.Join(root, "Downloads", "Gambo Pack", "mods")
	os.MkdirAll(good, 0o755)
	os.WriteFile(filepath.Join(good, "WEAPONS_PLAYER.rpf"), rpf(encNG, true), 0o644)
	os.WriteFile(filepath.Join(good, "RESIDENT.rpf"), rpf(encOpen, true), 0o644)
	// the game's own archives (sounds encrypted, no readable container) are skipped
	game := filepath.Join(root, "Downloads", "gtafiles")
	os.MkdirAll(game, 0o755)
	os.WriteFile(filepath.Join(game, "WEAPONS_PLAYER.rpf"), rpf(encNG, false), 0o644)
	// resident alone is no candidate
	lone := filepath.Join(root, "Downloads", "lone")
	os.MkdirAll(lone, 0o755)
	os.WriteFile(filepath.Join(lone, "RESIDENT.rpf"), rpf(encNG, true), 0o644)
	// a ZIP with a soundpack inside
	zf, _ := os.Create(filepath.Join(root, "Downloads", "Pruda Pack.zip"))
	zw := zip.NewWriter(zf)
	w, _ := zw.Create("Pruda Pack/mods/WEAPONS_PLAYER_2.rpf")
	w.Write(rpf(encNG, true))
	w, _ = zw.Create("Pruda Pack/mods/RESIDENT.rpf")
	w.Write(rpf(encNG, true))
	zw.Close()
	zf.Close()

	cs := Search([]Root{{Source: "Downloads", Dir: filepath.Join(root, "Downloads"), Depth: 3}}, 10000)
	if len(cs) != 2 {
		t.Fatalf("want 2 candidates, got %d: %+v", len(cs), cs)
	}
	kinds := map[string]Candidate{}
	for _, c := range cs {
		kinds[c.Kind] = c
		if len(c.Files) != 2 {
			t.Errorf("%s: want both archives, got %+v", c.Path, c.Files)
		}
	}
	z := kinds["zip"]
	b, err := Read(z, "WEAPONS_PLAYER.rpf")
	if err != nil || binary.LittleEndian.Uint32(b) != rpf7Magic {
		t.Fatalf("zip read: %v", err)
	}
	if _, err := Read(z, "other.rpf"); err != ErrNotFound {
		t.Errorf("unknown name must not be read")
	}
	d := kinds["dir"]
	if b, err := Read(d, "RESIDENT.rpf"); err != nil || len(b) != 2048 {
		t.Errorf("dir read: %v", err)
	}
}

func TestDepthLimit(t *testing.T) {
	root := t.TempDir()
	deep := filepath.Join(root, "a", "b", "c", "d", "e")
	os.MkdirAll(deep, 0o755)
	os.WriteFile(filepath.Join(deep, "WEAPONS_PLAYER.rpf"), rpf(encNG, true), 0o644)
	if cs := Search([]Root{{Source: "x", Dir: root, Depth: 2}}, 10000); len(cs) != 0 {
		t.Errorf("too deep folders must not be searched: %+v", cs)
	}
}

func TestRealSoundpackIsAccepted(t *testing.T) {
	p := "/root/.claude/uploads/b63bda24-5bec-533d-8c83-1ac727a53bce/4d29eede-WEAPONS_PLAYER.rpf"
	if _, err := os.Stat(p); err != nil {
		t.Skip("sample not available")
	}
	if !fileHasSounds(p) {
		t.Fatal("a real community soundpack must be recognised")
	}
}

func TestBigFolderDoesNotStopOtherRoots(t *testing.T) {
	big, other := t.TempDir(), t.TempDir()
	for i := 0; i < 50; i++ {
		os.WriteFile(filepath.Join(big, "junk"+string(rune('a'+i%26))+string(rune('a'+i/26))+".txt"), []byte("x"), 0o644)
	}
	os.WriteFile(filepath.Join(other, "WEAPONS_PLAYER.rpf"), rpf(encNG, true), 0o644)
	cs := Search([]Root{{Source: "Downloads", Dir: big, Depth: 3}, {Source: "Desktop", Dir: other, Depth: 3}}, 20)
	if len(cs) != 1 || cs[0].Source != "Desktop" {
		t.Fatalf("the second folder must still be searched: %+v", cs)
	}
	// the same folder listed twice is searched once
	if cs := Search([]Root{{Source: "a", Dir: other, Depth: 1}, {Source: "b", Dir: other, Depth: 1}}, 100); len(cs) != 1 {
		t.Fatalf("duplicate roots: %+v", cs)
	}
}

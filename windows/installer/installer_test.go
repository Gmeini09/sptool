package installer

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func setup(t *testing.T) (*Manager, string, *bool) {
	t.Helper()
	root := t.TempDir()
	mods := filepath.Join(root, "FiveM.app", "mods")
	running := false
	tick := time.Date(2026, 10, 2, 10, 0, 0, 0, time.UTC)
	m := &Manager{
		DataDir: filepath.Join(root, "data"),
		ModsDir: func() (string, error) { return mods, nil },
		Running: func() bool { return running },
		Now:     func() time.Time { tick = tick.Add(time.Second); return tick },
	}
	return m, mods, &running
}

func write(t *testing.T, p, s string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		return "<missing>"
	}
	return string(b)
}

func stage(t *testing.T, m *Manager, sess string, files map[string]string) []FileRef {
	t.Helper()
	var refs []FileRef
	for n, c := range files {
		sum, _, err := m.Stage(sess, n, strings.NewReader(c))
		if err != nil {
			t.Fatal(err)
		}
		refs = append(refs, FileRef{Name: n, SHA256: sum})
	}
	return refs
}

func TestInstallBackupRestore(t *testing.T) {
	m, mods, _ := setup(t)
	write(t, filepath.Join(mods, "WEAPONS_PLAYER.rpf"), "original-weapons")
	write(t, filepath.Join(mods, "other.rpf"), "untouched")

	sess := NewSession()
	refs := stage(t, m, sess, map[string]string{"WEAPONS_PLAYER.rpf": "new-weapons", "RESIDENT.rpf": "new-resident"})
	b, err := m.Install(sess, "My Pack", "1.0", refs)
	if err != nil {
		t.Fatal(err)
	}
	if got := read(t, filepath.Join(mods, "WEAPONS_PLAYER.rpf")); got != "new-weapons" {
		t.Fatalf("weapons = %q", got)
	}
	if got := read(t, filepath.Join(mods, "RESIDENT.rpf")); got != "new-resident" {
		t.Fatalf("resident = %q", got)
	}
	if got := read(t, filepath.Join(mods, "other.rpf")); got != "untouched" {
		t.Fatal("unrelated file changed")
	}
	if _, err := os.Stat(filepath.Join(m.DataDir, "staging", sess)); !os.IsNotExist(err) {
		t.Fatal("staging not cleaned")
	}
	// backup knows: weapons existed (with content), resident was new
	ex := map[string]bool{}
	for _, f := range b.Files {
		ex[f.Name] = f.Existed
	}
	if !ex["WEAPONS_PLAYER.rpf"] || ex["RESIDENT.rpf"] {
		t.Fatalf("backup files wrong: %+v", b.Files)
	}
	list, _ := m.List()
	if len(list) != 1 || list[0].Pack != "My Pack" {
		t.Fatalf("list: %+v", list)
	}

	// restore → original back, added file removed, and a before-restore backup exists
	safety, err := m.Restore(b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := read(t, filepath.Join(mods, "WEAPONS_PLAYER.rpf")); got != "original-weapons" {
		t.Fatalf("restored = %q", got)
	}
	if got := read(t, filepath.Join(mods, "RESIDENT.rpf")); got != "<missing>" {
		t.Fatal("added file not removed")
	}
	// undo the restore with the safety backup → installed state again
	if _, err := m.Restore(safety.ID); err != nil {
		t.Fatal(err)
	}
	if read(t, filepath.Join(mods, "WEAPONS_PLAYER.rpf")) != "new-weapons" || read(t, filepath.Join(mods, "RESIDENT.rpf")) != "new-resident" {
		t.Fatal("undo restore failed")
	}
	if l, _ := m.List(); len(l) != 3 {
		t.Fatalf("expected 3 backups, got %d", len(l))
	}
	if err := m.Delete(b.ID); err != nil {
		t.Fatal(err)
	}
	if l, _ := m.List(); len(l) != 2 {
		t.Fatal("delete failed")
	}
}

func TestRefusesWhileRunning(t *testing.T) {
	m, mods, running := setup(t)
	write(t, filepath.Join(mods, "a.rpf"), "old")
	sess := NewSession()
	refs := stage(t, m, sess, map[string]string{"a.rpf": "new"})
	*running = true
	if _, err := m.Install(sess, "p", "1", refs); err != ErrRunning {
		t.Fatalf("want ErrRunning, got %v", err)
	}
	if read(t, filepath.Join(mods, "a.rpf")) != "old" {
		t.Fatal("changed while running")
	}
}

func TestHashMismatchChangesNothing(t *testing.T) {
	m, mods, _ := setup(t)
	write(t, filepath.Join(mods, "a.rpf"), "old")
	sess := NewSession()
	refs := stage(t, m, sess, map[string]string{"a.rpf": "new"})
	refs[0].SHA256 = strings.Repeat("0", 64)
	if _, err := m.Install(sess, "p", "1", refs); err == nil || !strings.Contains(err.Error(), "hash") {
		t.Fatalf("want hash error, got %v", err)
	}
	if read(t, filepath.Join(mods, "a.rpf")) != "old" {
		t.Fatal("file changed")
	}
	if l, _ := m.List(); len(l) != 0 {
		t.Fatal("backup created for failed install")
	}
}

func TestRollbackOnFailure(t *testing.T) {
	m, mods, _ := setup(t)
	write(t, filepath.Join(mods, "a.rpf"), "old-a")
	// b.rpf is a folder in mods → replacing it must fail after a.rpf was already replaced
	if err := os.MkdirAll(filepath.Join(mods, "b.rpf"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(mods, "b.rpf", "x"), "x")
	sess := NewSession()
	refs := []FileRef{}
	for _, n := range []string{"a.rpf", "b.rpf"} {
		sum, _, _ := m.Stage(sess, n, strings.NewReader("new-"+n))
		refs = append(refs, FileRef{Name: n, SHA256: sum})
	}
	_, err := m.Install(sess, "p", "1", refs)
	if err == nil {
		t.Fatal("expected failure")
	}
	if read(t, filepath.Join(mods, "a.rpf")) != "old-a" {
		t.Fatalf("a.rpf not rolled back: %q (%v)", read(t, filepath.Join(mods, "a.rpf")), err)
	}
}

func TestNamesAreSafe(t *testing.T) {
	m, _, _ := setup(t)
	for _, n := range []string{"../evil.rpf", `..\evil.rpf`, "sub/x.rpf", `C:\x.rpf`, "x.exe", "x.rpf.exe", ".rpf", "", "con\x00.rpf"} {
		if _, _, err := m.Stage(NewSession(), n, bytes.NewReader([]byte("x"))); err == nil {
			t.Fatalf("accepted %q", n)
		}
	}
	for _, n := range []string{"WEAPONS_PLAYER.rpf", "resident.rpf", "My Pack (v2).rpf"} {
		if !ValidName(n) {
			t.Fatalf("rejected %q", n)
		}
	}
	if _, err := m.Restore("../../etc"); err != ErrNotFound {
		t.Fatal("restore accepted bad id")
	}
}

func TestTamperedBackupIsNotRestored(t *testing.T) {
	m, mods, _ := setup(t)
	write(t, filepath.Join(mods, "a.rpf"), "orig")
	sess := NewSession()
	b, err := m.Install(sess, "p", "1", stage(t, m, sess, map[string]string{"a.rpf": "new"}))
	if err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(m.DataDir, "backups", b.ID, "a.rpf"), "tampered")
	if _, err := m.Restore(b.ID); err == nil {
		t.Fatal("restored a tampered backup")
	}
	if read(t, filepath.Join(mods, "a.rpf")) != "new" {
		t.Fatal("mods changed by failed restore")
	}
}

func TestModsList(t *testing.T) {
	m, mods, _ := setup(t)
	write(t, filepath.Join(mods, "b.rpf"), "1")
	write(t, filepath.Join(mods, "A.rpf"), "22")
	write(t, filepath.Join(mods, "readme.txt"), "x")
	l, err := m.Mods()
	if err != nil || len(l) != 2 || l[0].Name != "A.rpf" || l[0].Size != 2 {
		t.Fatalf("mods: %+v %v", l, err)
	}
}

func TestConcurrentInstallsAreSerialized(t *testing.T) {
	m, mods, _ := setup(t)
	write(t, filepath.Join(mods, "x.rpf"), "orig")
	big := func(c string) string { return strings.Repeat(c, 2<<20) }
	s1, s2 := NewSession(), NewSession()
	r1 := stage(t, m, s1, map[string]string{"x.rpf": big("A")})
	r2 := stage(t, m, s2, map[string]string{"x.rpf": big("B")})
	errs := make(chan error, 2)
	go func() { _, err := m.Install(s1, "a", "1", r1); errs <- err }()
	go func() { _, err := m.Install(s2, "b", "1", r2); errs <- err }()
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	got := read(t, filepath.Join(mods, "x.rpf"))
	if got != big("A") && got != big("B") {
		t.Fatalf("mods file is a mix (len %d)", len(got))
	}
	if Busy(m.DataDir) {
		t.Fatal("lock file left behind")
	}
}

func TestDamagedBackupLeavesNoSafetyBackup(t *testing.T) {
	m, mods, _ := setup(t)
	write(t, filepath.Join(mods, "a.rpf"), "orig")
	sess := NewSession()
	b, err := m.Install(sess, "p", "1", stage(t, m, sess, map[string]string{"a.rpf": "new"}))
	if err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(m.DataDir, "backups", b.ID, "a.rpf"), "tampered")
	if _, err := m.Restore(b.ID); err == nil {
		t.Fatal("restored a damaged backup")
	}
	list, _ := m.List()
	if len(list) != 1 {
		t.Fatalf("expected only the install backup, got %d backups", len(list))
	}
}

func TestReservedAndStaleStaging(t *testing.T) {
	for _, n := range []string{"NUL.rpf", "con.rpf", "COM1.rpf", "lpt9.x.rpf"} {
		if ValidName(n) {
			t.Fatalf("%s accepted", n)
		}
	}
	if !ValidName("CONTENT.rpf") || !ValidName("console.rpf") {
		t.Fatal("normal names rejected")
	}
	m, _, _ := setup(t)
	old := filepath.Join(m.DataDir, "staging", "aaaaaaaa1111")
	write(t, filepath.Join(old, "a.rpf"), "x")
	past := time.Now().Add(-48 * time.Hour)
	_ = os.Chtimes(old, past, past)
	m.Now = time.Now
	m.CleanStaging(24 * time.Hour)
	if _, err := os.Stat(old); err == nil {
		t.Fatal("stale staging folder kept")
	}
}

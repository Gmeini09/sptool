// Package installer puts soundpack files into FiveM's mods folder – atomically and always restorable.
//
//	Stage    upload each file into a private staging folder (hash computed while writing)
//	Install  check FiveM is closed → verify staged hashes → back up every file that will be touched
//	         (and remember which ones are new) → replace → verify → on any error roll back
//	Restore  safety backup of the current state → put the backed-up files back (hash-verified),
//	         remove files the install had added
//
// Only plain file names with the .rpf extension are accepted, so nothing outside the mods folder
// can ever be written or deleted. Stdlib only, so it is tested on any OS.
package installer

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrRunning         = errors.New("FiveM is running – close it first")
	ErrNoFiveM         = errors.New("FiveM was not found")
	ErrBadName         = errors.New("invalid file name (only .rpf files without folders are allowed)")
	ErrHash            = errors.New("file hash does not match – the file was changed or damaged")
	ErrNotFound        = errors.New("not found")
	ErrNoFiles         = errors.New("nothing to install")
	MaxFileBytes int64 = 4 << 30
)

var (
	nameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 _.\-()]{0,95}\.rpf$`)
	idRe   = regexp.MustCompile(`^[A-Za-z0-9\-]{6,64}$`)
)

// Windows device names – "NUL.rpf" or "COM1.rpf" would not be a file at all.
var reserved = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[0-9]|lpt[0-9])$`)

// ValidName reports whether a file name may be written into the mods folder.
func ValidName(n string) bool {
	if !nameRe.MatchString(n) || strings.Contains(n, "..") || filepath.Base(n) != n {
		return false
	}
	stem := strings.TrimRight(strings.SplitN(n, ".", 2)[0], " ")
	return !reserved.MatchString(stem)
}

// Only one install / restore / delete at a time (double clicks, two windows). While one runs, a lock
// file in the data folder tells a starting update to wait instead of killing SP Tool mid-install.
var opMu sync.Mutex

const lockName = "install.lock"

func (m *Manager) begin() func() {
	opMu.Lock()
	lock := filepath.Join(m.DataDir, lockName)
	_ = os.MkdirAll(m.DataDir, 0o755)
	_ = os.WriteFile(lock, []byte(fmt.Sprint(os.Getpid())), 0o644)
	return func() { _ = os.Remove(lock); opMu.Unlock() }
}

// Busy reports whether an install or restore is running right now (lock file younger than 10 minutes).
func Busy(dataDir string) bool {
	st, err := os.Stat(filepath.Join(dataDir, lockName))
	return err == nil && time.Since(st.ModTime()) < 10*time.Minute
}

// CleanStaging removes staging folders older than maxAge (left behind by failed or abandoned installs).
func (m *Manager) CleanStaging(maxAge time.Duration) {
	entries, err := os.ReadDir(m.stagingDir())
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() || !idRe.MatchString(e.Name()) {
			continue
		}
		if info, err := e.Info(); err == nil && m.now().Sub(info.ModTime()) > maxAge {
			_ = os.RemoveAll(filepath.Join(m.stagingDir(), e.Name()))
		}
	}
}

type Manager struct {
	DataDir string                 // SP Tool data folder (staging + backups live here)
	ModsDir func() (string, error) // FiveM.app\mods
	Running func() bool            // is FiveM running?
	Now     func() time.Time
}

type BackupFile struct {
	Name    string `json:"name"`
	Existed bool   `json:"existed"` // false = the install added this file (restore removes it)
	Size    int64  `json:"size,omitempty"`
	SHA256  string `json:"sha256,omitempty"`
}

type Backup struct {
	ID        string       `json:"id"`
	Kind      string       `json:"kind"` // install | before-restore
	Pack      string       `json:"pack"`
	Version   string       `json:"version"`
	CreatedAt int64        `json:"createdAt"`
	Files     []BackupFile `json:"files"`
	Installed []BackupFile `json:"installed,omitempty"` // what was written (for display)
	Size      int64        `json:"size"`
}

type ModFile struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	Modified int64  `json:"modified"`
}

type FileRef struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
}

func (m *Manager) now() time.Time {
	if m.Now != nil {
		return m.Now()
	}
	return time.Now()
}
func (m *Manager) stagingDir() string { return filepath.Join(m.DataDir, "staging") }
func (m *Manager) backupsDir() string { return filepath.Join(m.DataDir, "backups") }

func (m *Manager) mods() (string, error) {
	if m.ModsDir == nil {
		return "", ErrNoFiveM
	}
	d, err := m.ModsDir()
	if err != nil || d == "" {
		return "", ErrNoFiveM
	}
	if err := os.MkdirAll(d, 0o755); err != nil {
		return "", err
	}
	return d, nil
}

// NewSession returns a random staging session id.
func NewSession() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ── staging ──────────────────────────────────────────────────────────────────

// Stage writes one file into the session's staging folder and returns its SHA-256.
func (m *Manager) Stage(session, name string, r io.Reader) (string, int64, error) {
	if !idRe.MatchString(session) {
		return "", 0, errors.New("invalid session")
	}
	if !ValidName(name) {
		return "", 0, ErrBadName
	}
	dir := filepath.Join(m.stagingDir(), session)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", 0, err
	}
	f, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		return "", 0, err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(r, MaxFileBytes+1))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil && n > MaxFileBytes {
		err = errors.New("file too large")
	}
	if err != nil {
		_ = os.Remove(filepath.Join(dir, name))
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

// DiscardSession removes a staging folder.
func (m *Manager) DiscardSession(session string) {
	if idRe.MatchString(session) {
		_ = os.RemoveAll(filepath.Join(m.stagingDir(), session))
	}
}

// ── install ──────────────────────────────────────────────────────────────────

// Install moves the staged files into the mods folder. Every touched file is backed up first;
// if anything fails the mods folder is restored to exactly what it was.
func (m *Manager) Install(session, pack, version string, files []FileRef) (*Backup, error) {
	if !idRe.MatchString(session) {
		return nil, errors.New("invalid session")
	}
	if len(files) == 0 {
		return nil, ErrNoFiles
	}
	defer m.begin()()
	if m.Running != nil && m.Running() {
		return nil, ErrRunning
	}
	mods, err := m.mods()
	if err != nil {
		return nil, err
	}
	stage := filepath.Join(m.stagingDir(), session)
	seen := map[string]bool{}
	installed := make([]BackupFile, 0, len(files))
	for _, f := range files {
		key := strings.ToLower(f.Name)
		if !ValidName(f.Name) || seen[key] {
			return nil, ErrBadName
		}
		seen[key] = true
		sum, size, err := hashFile(filepath.Join(stage, f.Name))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f.Name, err)
		}
		if !strings.EqualFold(sum, f.SHA256) {
			return nil, fmt.Errorf("%s: %w", f.Name, ErrHash)
		}
		installed = append(installed, BackupFile{Name: f.Name, Existed: true, Size: size, SHA256: sum})
	}

	b, err := m.snapshot("install", pack, version, mods, names(files))
	if err != nil {
		return nil, fmt.Errorf("backup failed, nothing was changed: %w", err)
	}
	b.Installed = installed
	_ = m.writeManifest(b)

	for i, f := range files {
		if err := replaceFile(filepath.Join(stage, f.Name), filepath.Join(mods, f.Name), installed[i].SHA256); err != nil {
			rbErr := m.apply(b, mods)
			if rbErr != nil {
				return nil, fmt.Errorf("install failed (%v) and rollback failed (%v) – restore backup %s manually", err, rbErr, b.ID)
			}
			_ = m.remove(b.ID)
			return nil, fmt.Errorf("install failed, all files were restored: %w", err)
		}
	}
	m.DiscardSession(session)
	return b, nil
}

// ── backups ──────────────────────────────────────────────────────────────────

func (m *Manager) snapshot(kind, pack, version, mods string, list []string) (*Backup, error) {
	t := m.now()
	b := &Backup{ID: fmt.Sprintf("%s-%s", t.UTC().Format("20060102-150405"), NewSession()[:6]), Kind: kind, Pack: pack, Version: version, CreatedAt: t.UnixMilli()}
	dir := filepath.Join(m.backupsDir(), b.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	for _, n := range list {
		src := filepath.Join(mods, n)
		st, err := os.Stat(src)
		if errors.Is(err, os.ErrNotExist) {
			b.Files = append(b.Files, BackupFile{Name: n, Existed: false})
			continue
		}
		if err != nil {
			_ = os.RemoveAll(dir)
			return nil, err
		}
		if st.IsDir() {
			_ = os.RemoveAll(dir)
			return nil, fmt.Errorf("%s is a folder", n)
		}
		sum, err := copyHashed(src, filepath.Join(dir, n))
		if err != nil {
			_ = os.RemoveAll(dir)
			return nil, err
		}
		b.Files = append(b.Files, BackupFile{Name: n, Existed: true, Size: st.Size(), SHA256: sum})
		b.Size += st.Size()
	}
	if err := m.writeManifest(b); err != nil {
		_ = os.RemoveAll(dir)
		return nil, err
	}
	return b, nil
}

func (m *Manager) writeManifest(b *Backup) error {
	data, _ := json.MarshalIndent(b, "", "  ")
	p := filepath.Join(m.backupsDir(), b.ID, "manifest.json")
	if err := os.WriteFile(p+".tmp", data, 0o644); err != nil {
		return err
	}
	return os.Rename(p+".tmp", p)
}

// apply puts a backup's files back into the mods folder (hash-verified) and removes added files.
func (m *Manager) apply(b *Backup, mods string) error {
	if err := m.verify(b); err != nil {
		return err
	}
	dir := filepath.Join(m.backupsDir(), b.ID)
	for _, f := range b.Files {
		target := filepath.Join(mods, f.Name)
		if !f.Existed {
			if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			continue
		}
		if err := replaceFile(filepath.Join(dir, f.Name), target, f.SHA256); err != nil {
			return err
		}
	}
	return nil
}

// verify checks that every backed-up file is still intact before anything is touched.
func (m *Manager) verify(b *Backup) error {
	dir := filepath.Join(m.backupsDir(), b.ID)
	for _, f := range b.Files {
		if !ValidName(f.Name) {
			return ErrBadName
		}
		if f.Existed {
			sum, _, err := hashFile(filepath.Join(dir, f.Name))
			if err != nil || !strings.EqualFold(sum, f.SHA256) {
				return fmt.Errorf("%s: %w", f.Name, ErrHash)
			}
		}
	}
	return nil
}

// List returns all backups, newest first.
func (m *Manager) List() ([]Backup, error) {
	entries, err := os.ReadDir(m.backupsDir())
	if errors.Is(err, os.ErrNotExist) {
		return []Backup{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []Backup{}
	for _, e := range entries {
		if !e.IsDir() || !idRe.MatchString(e.Name()) {
			continue
		}
		b, err := m.load(e.Name())
		if err == nil {
			out = append(out, *b)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out, nil
}

func (m *Manager) load(id string) (*Backup, error) {
	if !idRe.MatchString(id) {
		return nil, ErrNotFound
	}
	data, err := os.ReadFile(filepath.Join(m.backupsDir(), id, "manifest.json"))
	if err != nil {
		return nil, ErrNotFound
	}
	var b Backup
	if err := json.Unmarshal(data, &b); err != nil || b.ID != id {
		return nil, ErrNotFound
	}
	return &b, nil
}

// Restore brings the mods folder back to the state stored in a backup. The current state is
// backed up first ("before-restore"), so a restore can itself be undone.
func (m *Manager) Restore(id string) (*Backup, error) {
	defer m.begin()()
	b, err := m.load(id)
	if err != nil {
		return nil, err
	}
	if m.Running != nil && m.Running() {
		return nil, ErrRunning
	}
	mods, err := m.mods()
	if err != nil {
		return nil, err
	}
	// a damaged backup is refused before anything (including the safety backup) is written
	if err := m.verify(b); err != nil {
		return nil, fmt.Errorf("this backup is damaged, nothing was changed: %w", err)
	}
	safety, err := m.snapshot("before-restore", b.Pack, b.Version, mods, backupNames(b))
	if err != nil {
		return nil, fmt.Errorf("safety backup failed, nothing was changed: %w", err)
	}
	if err := m.apply(b, mods); err != nil {
		if rb := m.apply(safety, mods); rb != nil {
			return nil, fmt.Errorf("restore failed (%v) and rollback failed (%v) – restore backup %s manually", err, rb, safety.ID)
		}
		_ = m.remove(safety.ID)
		return nil, fmt.Errorf("restore failed, nothing was changed: %w", err)
	}
	return safety, nil
}

// Delete removes a backup.
func (m *Manager) Delete(id string) error {
	defer m.begin()()
	return m.remove(id)
}

func (m *Manager) remove(id string) error {
	if _, err := m.load(id); err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(m.backupsDir(), id))
}

// OpenMod opens one .rpf file directly inside FiveM's mods folder for reading (e.g. as the base pack for a build).
func (m *Manager) OpenMod(name string) (*os.File, int64, error) {
	if !ValidName(name) {
		return nil, 0, ErrBadName
	}
	mods, err := m.mods()
	if err != nil {
		return nil, 0, err
	}
	f, err := os.Open(filepath.Join(mods, name))
	if err != nil {
		return nil, 0, ErrNotFound
	}
	st, err := f.Stat()
	if err != nil || st.IsDir() || st.Size() > MaxFileBytes {
		f.Close()
		return nil, 0, ErrNotFound
	}
	return f, st.Size(), nil
}

// Mods lists the .rpf files currently in the mods folder.
func (m *Manager) Mods() ([]ModFile, error) {
	mods, err := m.mods()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(mods)
	if err != nil {
		return nil, err
	}
	out := []ModFile{}
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".rpf") {
			continue
		}
		if st, err := e.Info(); err == nil {
			out = append(out, ModFile{Name: e.Name(), Size: st.Size(), Modified: st.ModTime().UnixMilli()})
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

// ── file helpers ─────────────────────────────────────────────────────────────

func names(files []FileRef) []string {
	out := make([]string, len(files))
	for i, f := range files {
		out[i] = f.Name
	}
	return out
}

func backupNames(b *Backup) []string {
	out := make([]string, len(b.Files))
	for i, f := range b.Files {
		out[i] = f.Name
	}
	return out
}

func hashFile(p string) (string, int64, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	return hex.EncodeToString(h.Sum(nil)), n, err
}

func copyHashed(src, dst string) (string, error) {
	in, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(out, h), in)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(dst)
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// replaceFile copies src next to dst, verifies the hash and renames it over dst (atomic on NTFS).
func replaceFile(src, dst, wantSHA string) error {
	tmp := fmt.Sprintf("%s.%s.sptool-tmp", dst, NewSession()[:8]) // unique per call
	sum, err := copyHashed(src, tmp)
	if err != nil {
		return err
	}
	if !strings.EqualFold(sum, wantSHA) {
		_ = os.Remove(tmp)
		return fmt.Errorf("%s: %w", filepath.Base(dst), ErrHash)
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

package installer

import (
	"io/fs"
	"path/filepath"
	"strings"
)

// ScanFile is one weapon-sound archive found in (or below) the mods folder – read only, nothing is changed.
type ScanFile struct {
	Path     string `json:"path"` // relative to the mods folder, with "\" (e.g. "WEAPONS_PLAYER.rpf", "testest\RESIDENT.rpf")
	Name     string `json:"name"`
	Depth    int    `json:"depth"` // 0 = directly in mods (the only place FiveM reads it from)
	Size     int64  `json:"size"`
	Modified int64  `json:"modified"`
	SHA256   string `json:"sha256"`
}

type ScanResult struct {
	ModsDir string     `json:"modsDir"`
	Running bool       `json:"running"`
	Files   []ScanFile `json:"files"`
}

// soundArchive: names that are (or were meant to be) WEAPONS_PLAYER.rpf / RESIDENT.rpf, incl. "WEAPONS_PLAYER (2).rpf".
func soundArchive(name string) bool {
	n := strings.ToLower(name)
	return strings.HasSuffix(n, ".rpf") && (strings.HasPrefix(n, "weapons_player") || strings.HasPrefix(n, "resident"))
}

// Scan lists and hashes the weapon-sound archives in the mods folder and up to three folder levels below it,
// so SP Tool can tell whether the pack the user just built is the one FiveM will actually load.
func (m *Manager) Scan() (ScanResult, error) {
	mods, err := m.mods()
	if err != nil {
		return ScanResult{}, err
	}
	res := ScanResult{ModsDir: mods, Files: []ScanFile{}}
	if m.Running != nil {
		res.Running = m.Running()
	}
	_ = filepath.WalkDir(mods, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(mods, p)
		depth := strings.Count(filepath.ToSlash(rel), "/")
		if d.IsDir() {
			if rel != "." && depth >= 3 {
				return filepath.SkipDir
			}
			return nil
		}
		if !soundArchive(d.Name()) || len(res.Files) >= 40 {
			return nil
		}
		st, err := d.Info()
		if err != nil || st.Size() > MaxFileBytes {
			return nil
		}
		sum, _, err := hashFile(p)
		if err != nil {
			return nil
		}
		res.Files = append(res.Files, ScanFile{Path: strings.ReplaceAll(filepath.ToSlash(rel), "/", `\`), Name: d.Name(), Depth: depth, Size: st.Size(), Modified: st.ModTime().UnixMilli(), SHA256: sum})
		return nil
	})
	return res, nil
}


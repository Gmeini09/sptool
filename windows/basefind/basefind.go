// Package basefind looks on the user's PC for a working weapon soundpack (WEAPONS_PLAYER.rpf + RESIDENT.rpf)
// that SP Tool can use as its base: in FiveM's mods folder, OpenIV's mods folder of GTA V, and in Downloads /
// Desktop / Documents – loose files or inside a ZIP. Only archives with readable sounds are offered (soundpacks:
// the table of contents may be encrypted, the sounds are not); the game's own archives are skipped.
// Everything is read-only. Read() only serves files of candidates this package found itself.
package basefind

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const (
	rpf7Magic = 0x52504637
	maxZip    = 600 << 20
	maxRpf    = 400 << 20
)

// Root is a folder to search; Depth = how many folder levels below it are searched.
type Root struct {
	Source string
	Dir    string
	Depth  int
}

// File is one archive of a candidate.
type File struct {
	Name  string `json:"name"` // canonical: WEAPONS_PLAYER.rpf / RESIDENT.rpf
	Size  int64  `json:"size"`
	path  string // loose file
	entry string // zip entry name
}

// Candidate is a pack that can be adopted as the base.
type Candidate struct {
	ID       string `json:"id"`
	Source   string `json:"source"`
	Label    string `json:"label"`
	Path     string `json:"path"`
	Kind     string `json:"kind"` // "dir" | "zip"
	Modified int64  `json:"modified"`
	Files    []File `json:"files"`
	zipPath  string
}

var (
	wpRe  = regexp.MustCompile(`(?i)weapons_?player`)
	resRe = regexp.MustCompile(`(?i)(^|[^a-z])resident([^a-z]|$)`)
)

// Canonical maps "WEAPONS_PLAYER_5_7.rpf", "Gambo-WEAPONS_PLAYER.rpf", "resident (2).rpf" … to the game name,
// or "" when it is neither.
func Canonical(name string) string {
	b := filepath.Base(strings.ReplaceAll(name, `\`, "/"))
	if !strings.HasSuffix(strings.ToLower(b), ".rpf") {
		return ""
	}
	stem := strings.TrimSuffix(b, filepath.Ext(b))
	if wpRe.MatchString(stem) {
		return "WEAPONS_PLAYER.rpf"
	}
	if resRe.MatchString(stem) {
		return "RESIDENT.rpf"
	}
	return ""
}

// isRpf7 reports whether the first bytes are an RPF7 archive.
func isRpf7(head []byte) bool {
	return len(head) >= 16 && binary.LittleEndian.Uint32(head) == rpf7Magic
}

// hasSounds reports whether the archive holds readable audio containers ("ADAT" at a 512-byte boundary) –
// true for weapon soundpacks (their table of contents may be encrypted, the sounds are not), false for the
// game's own archives whose sounds are encrypted. Reads at most limit bytes.
func hasSounds(r io.Reader, limit int64) bool {
	head := make([]byte, 16)
	if n, _ := io.ReadFull(r, head); !isRpf7(head[:n]) {
		return false
	}
	buf := make([]byte, 1<<20)
	pos := int64(16)
	carry := 0
	for pos < limit {
		n, err := r.Read(buf[carry:])
		total := carry + n
		start := int64(pos) - int64(carry)
		for i := 0; i+4 <= total; i++ {
			if (start+int64(i))%512 == 0 && buf[i] == 'A' && buf[i+1] == 'D' && buf[i+2] == 'A' && buf[i+3] == 'T' {
				return true
			}
		}
		pos += int64(n)
		if err != nil {
			return false
		}
		// keep the last 3 bytes in case the magic crosses the chunk border
		k := 3
		if total < k {
			k = total
		}
		copy(buf, buf[total-k:total])
		carry = k
	}
	return false
}

func fileHasSounds(p string) bool {
	f, err := os.Open(p)
	if err != nil {
		return false
	}
	defer f.Close()
	return hasSounds(f, maxRpf)
}

var skipDirs = map[string]bool{"node_modules": true, "appdata": true, "$recycle.bin": true, "windows": true, ".git": true, "steamapps": true}

// Search walks the roots and returns candidates, newest first. limit caps the number of visited entries.
func Search(roots []Root, limit int) []Candidate {
	var out []Candidate
	seen := map[string]bool{}
	searched := map[string]bool{}
	for _, r := range roots {
		base := filepath.Clean(r.Dir)
		if st, err := os.Stat(base); err != nil || !st.IsDir() || searched[strings.ToLower(base)] {
			continue
		}
		searched[strings.ToLower(base)] = true
		visited := 0 // per root: a huge Downloads folder must not stop the search of the other folders
		baseDepth := strings.Count(base, string(filepath.Separator))
		dirs := map[string][]File{}
		dirMod := map[string]int64{}
		_ = filepath.WalkDir(base, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				if d != nil && d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			visited++
			if visited > limit {
				return fs.SkipAll
			}
			if d.IsDir() {
				if p != base && (skipDirs[strings.ToLower(d.Name())] || strings.Count(p, string(filepath.Separator))-baseDepth > r.Depth) {
					return fs.SkipDir
				}
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			lower := strings.ToLower(d.Name())
			if strings.HasSuffix(lower, ".zip") && info.Size() < maxZip {
				if c, ok := scanZip(r.Source, p, info.ModTime().Unix()); ok && !seen[p] {
					seen[p] = true
					out = append(out, c)
				}
				return nil
			}
			if cn := Canonical(d.Name()); cn != "" && info.Size() < maxRpf && fileHasSounds(p) {
				dir := filepath.Dir(p)
				dirs[dir] = append(dirs[dir], File{Name: cn, Size: info.Size(), path: p})
				if t := info.ModTime().Unix(); t > dirMod[dir+"|"+cn] {
					dirMod[dir+"|"+cn] = t
				}
			}
			return nil
		})
		for dir, files := range dirs {
			c, ok := pick(files, func(f File) int64 {
				st, err := os.Stat(f.path)
				if err != nil {
					return 0
				}
				return st.ModTime().Unix()
			})
			if !ok || seen[dir] {
				continue
			}
			seen[dir] = true
			c.Source, c.Kind, c.Path, c.Label = r.Source, "dir", dir, filepath.Base(dir)
			out = append(out, c)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Modified > out[j].Modified })
	for i := range out {
		out[i].ID = fmt.Sprintf("c%d", i+1)
	}
	return out
}

// pick keeps the newest WEAPONS_PLAYER and RESIDENT of a group; a candidate needs WEAPONS_PLAYER.
func pick(files []File, mod func(File) int64) (Candidate, bool) {
	best := map[string]File{}
	bestT := map[string]int64{}
	var newest int64
	for _, f := range files {
		t := mod(f)
		if _, ok := best[f.Name]; !ok || t > bestT[f.Name] {
			best[f.Name], bestT[f.Name] = f, t
		}
		if t > newest {
			newest = t
		}
	}
	wp, ok := best["WEAPONS_PLAYER.rpf"]
	if !ok {
		return Candidate{}, false
	}
	c := Candidate{Files: []File{wp}, Modified: newest}
	if res, ok := best["RESIDENT.rpf"]; ok {
		c.Files = append(c.Files, res)
	}
	return c, true
}

func scanZip(source, p string, mod int64) (Candidate, bool) {
	zr, err := zip.OpenReader(p)
	if err != nil {
		return Candidate{}, false
	}
	defer zr.Close()
	var files []File
	for _, f := range zr.File {
		cn := Canonical(f.Name)
		if cn == "" || f.FileInfo().IsDir() || f.UncompressedSize64 > maxRpf {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		ok := hasSounds(rc, maxRpf)
		rc.Close()
		if !ok {
			continue
		}
		files = append(files, File{Name: cn, Size: int64(f.UncompressedSize64), entry: f.Name})
	}
	c, ok := pick(files, func(f File) int64 { return 0 })
	if !ok {
		return Candidate{}, false
	}
	c.Source, c.Kind, c.Path, c.Label, c.Modified, c.zipPath = source, "zip", p, strings.TrimSuffix(filepath.Base(p), filepath.Ext(p)), mod, p
	return c, true
}

// ErrNotFound: the candidate has no such file.
var ErrNotFound = errors.New("datei nicht gefunden")

// Read returns the bytes of one archive of a candidate (name = WEAPONS_PLAYER.rpf / RESIDENT.rpf).
func Read(c Candidate, name string) ([]byte, error) {
	for _, f := range c.Files {
		if !strings.EqualFold(f.Name, name) {
			continue
		}
		if c.Kind == "dir" {
			return os.ReadFile(f.path)
		}
		zr, err := zip.OpenReader(c.zipPath)
		if err != nil {
			return nil, err
		}
		defer zr.Close()
		for _, zf := range zr.File {
			if zf.Name != f.entry {
				continue
			}
			rc, err := zf.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			var buf bytes.Buffer
			if _, err := io.Copy(&buf, io.LimitReader(rc, maxRpf+1)); err != nil {
				return nil, err
			}
			return buf.Bytes(), nil
		}
	}
	return nil, ErrNotFound
}

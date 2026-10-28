// Package updatepkg checks a downloaded SP Tool release ZIP and extracts its SPTool.exe for an in-app update.
package updatepkg

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const maxExe = 80 << 20 // SPTool.exe is ~10 MB; anything far larger is not ours

var (
	ErrHash    = errors.New("die Datei ist beschädigt (Prüfsumme stimmt nicht)")
	ErrVersion = errors.New("diese Version ist nicht neuer als die installierte")
	ErrNoExe   = errors.New("im Update fehlt SPTool.exe")
	ErrNotExe  = errors.New("SPTool.exe im Update ist keine Windows-Programmdatei")
)

// Newer reports whether version a (x.y.z) is newer than b.
func Newer(a, b string) bool {
	pa, pb := parts(a), parts(b)
	if pa == nil {
		return false
	}
	if pb == nil {
		return true
	}
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return false
}

func parts(v string) []int {
	s := strings.Split(strings.TrimSpace(v), ".")
	if len(s) != 3 {
		return nil
	}
	out := make([]int, 3)
	for i, x := range s {
		n, err := strconv.Atoi(x)
		if err != nil || n < 0 || n > 9999 {
			return nil
		}
		out[i] = n
	}
	return out
}

// Extract verifies the ZIP against the expected SHA-256 (hex) and the version rule, then writes the contained
// SPTool.exe to dir/<version>/SPTool.exe and returns that path.
func Extract(zipData []byte, wantSHA, newVersion, curVersion, dir string) (string, error) {
	sum := sha256.Sum256(zipData)
	if !strings.EqualFold(hex.EncodeToString(sum[:]), strings.TrimSpace(wantSHA)) {
		return "", ErrHash
	}
	if curVersion != "dev" && !Newer(newVersion, curVersion) {
		return "", ErrVersion
	}
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return "", err
	}
	var exe *zip.File
	for _, f := range zr.File {
		if strings.EqualFold(filepath.Base(filepath.FromSlash(f.Name)), "SPTool.exe") && !f.FileInfo().IsDir() {
			exe = f
			break
		}
	}
	if exe == nil {
		return "", ErrNoExe
	}
	if exe.UncompressedSize64 > maxExe {
		return "", ErrNotExe
	}
	rc, err := exe.Open()
	if err != nil {
		return "", err
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, maxExe+1))
	if err != nil {
		return "", err
	}
	if len(data) > maxExe || len(data) < 2 || data[0] != 'M' || data[1] != 'Z' {
		return "", ErrNotExe
	}
	if parts(newVersion) == nil {
		return "", ErrVersion
	}
	target := filepath.Join(dir, newVersion)
	if err := os.MkdirAll(target, 0o755); err != nil {
		return "", err
	}
	out := filepath.Join(target, "SPTool.exe")
	if err := os.WriteFile(out+".part", data, 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(out+".part", out); err != nil {
		return "", err
	}
	return out, nil
}

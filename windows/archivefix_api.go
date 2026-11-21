//go:build windows

package main

// GET  /native/archivefix/find?path=        where ArchiveFix.exe is: the given path, else a search on Desktop, Downloads
//                                           and Documents (3 folders deep); answers {path, hasKeys} or 404
// POST /native/archivefix/run?exe=&file=    body = WEAPONS_PLAYER.rpf / RESIDENT.rpf with an open table of contents;
//                                           runs ArchiveFix on a copy (exactly like dropping the file onto it) and
//                                           answers the encrypted archive
//
// ArchiveFix encrypts the table of contents with the key of the FILE NAME, so the copy keeps its exact name. It waits
// for a key press at the end and crashes without a console – the result is checked by its header instead.

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const rpfOpen = 0x4e45504f

var archiveFixKeys = []string{"gtav_ng_key.dat", "gtav_ng_encrypt_tables.dat", "gtav_ng_encrypt_luts.dat"}

func isArchiveFix(p string) bool {
	if !strings.EqualFold(filepath.Base(p), "ArchiveFix.exe") {
		return false
	}
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func hasArchiveFixKeys(exe string) bool {
	dir := filepath.Dir(exe)
	for _, k := range archiveFixKeys {
		if _, err := os.Stat(filepath.Join(dir, k)); err != nil {
			return false
		}
	}
	return true
}

// findArchiveFix looks a few folders deep below the usual user folders.
func findArchiveFix(given string) string {
	if given != "" && isArchiveFix(given) {
		return given
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	for _, root := range []string{"Desktop", "Downloads", "Documents", filepath.Join("OneDrive", "Desktop")} {
		base := filepath.Join(home, root)
		found := ""
		_ = filepath.WalkDir(base, func(p string, d os.DirEntry, err error) error {
			if err != nil || found != "" {
				return filepath.SkipDir
			}
			if d.IsDir() {
				if rel, _ := filepath.Rel(base, p); strings.Count(rel, string(filepath.Separator)) >= 3 {
					return filepath.SkipDir
				}
				return nil
			}
			if strings.EqualFold(d.Name(), "ArchiveFix.exe") {
				found = p
				return filepath.SkipAll
			}
			return nil
		})
		if found != "" {
			return found
		}
	}
	return ""
}

func archiveFixAPI(w http.ResponseWriter, r *http.Request) bool {
	switch r.URL.Path {
	case "/native/archivefix/find":
		p := findArchiveFix(r.URL.Query().Get("path"))
		if p == "" {
			http.Error(w, "ArchiveFix.exe nicht gefunden", http.StatusNotFound)
			return true
		}
		writeJSON(w, map[string]any{"path": p, "hasKeys": hasArchiveFixKeys(p)})
		return true
	case "/native/archivefix/run":
		if r.Method != http.MethodPost {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return true
		}
		exe := r.URL.Query().Get("exe")
		file := r.URL.Query().Get("file")
		if !isArchiveFix(exe) {
			http.Error(w, "ArchiveFix.exe nicht gefunden: "+exe, http.StatusBadRequest)
			return true
		}
		if file != "WEAPONS_PLAYER.rpf" && file != "RESIDENT.rpf" {
			http.Error(w, "unbekannte Datei", http.StatusBadRequest)
			return true
		}
		data, err := io.ReadAll(io.LimitReader(r.Body, maxArchive))
		if err != nil || len(data) < 16 || binary.LittleEndian.Uint32(data[12:16]) != rpfOpen {
			http.Error(w, "kein offenes RPF-Archiv", http.StatusBadRequest)
			return true
		}
		dir, err := os.MkdirTemp("", "sptool-archivefix-")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return true
		}
		defer os.RemoveAll(dir)
		target := filepath.Join(dir, file)
		if err := os.WriteFile(target, data, 0o644); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return true
		}
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
		defer cancel()
		cmd := exec.CommandContext(ctx, exe, target)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWin}
		cmd.Dir = filepath.Dir(exe) // ArchiveFix reads its key files from its own folder
		var out bytes.Buffer
		cmd.Stdout, cmd.Stderr = &out, &out
		_ = cmd.Run() // exits with an error at "press any key" even when it worked
		fixed, err := os.ReadFile(target)
		if err != nil || len(fixed) != len(data) || binary.LittleEndian.Uint32(fixed[12:16]) == rpfOpen {
			msg := strings.ReplaceAll(out.String(), "\x00", "")
			if len(msg) > 600 {
				msg = msg[len(msg)-600:]
			}
			http.Error(w, "ArchiveFix hat "+file+" nicht verschlüsselt. "+strings.TrimSpace(msg), http.StatusUnprocessableEntity)
			return true
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(fixed)
		return true
	}
	return false
}

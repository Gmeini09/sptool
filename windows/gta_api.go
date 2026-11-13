package main

// /native/gta/awckey  – the AWC key from the player's own GTA5.exe (found by its SHA-1, never stored in SP Tool)
// /native/gta/sfx     – one original archive (WEAPONS_PLAYER.rpf / RESIDENT.rpf) from GTA V's x64/audio/sfx folder
// Both are read only. The web side checks the archive against the known original (src/formats/gtaOriginal.ts).

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

var awcKeySHA1, _ = hex.DecodeString("c31e0da1c7e5d85502e517290ed07b180a94e911")

// gtaDirs: the GTA V folders to look in – the one the user chose in FiveM first, then the detected installs.
func gtaDirs(r *http.Request) []string {
	var dirs []string
	if g := strings.TrimSpace(r.URL.Query().Get("gta")); g != "" {
		dirs = append(dirs, g)
	}
	if st := detectFiveM(r.URL.Query().Get("root")); st.ConfiguredGtaPath != nil && *st.ConfiguredGtaPath != "" {
		dirs = append(dirs, *st.ConfiguredGtaPath)
	}
	for _, g := range detectGta("") {
		if g.Valid {
			dirs = append(dirs, g.Path)
		}
	}
	return dirs
}

// findAwcKey scans the exe for the 16-byte key (8-byte aligned) by its SHA-1.
func findAwcKey(exe []byte) []byte {
	for p := 0; p+16 <= len(exe); p += 8 {
		h := sha1.Sum(exe[p : p+16])
		if bytes.Equal(h[:], awcKeySHA1) {
			return append([]byte(nil), exe[p:p+16]...)
		}
	}
	return nil
}

func gtaAPI(w http.ResponseWriter, r *http.Request) bool {
	switch r.URL.Path {
	case "/native/gta/awckey":
		for _, d := range gtaDirs(r) {
			exe, err := os.ReadFile(filepath.Join(d, "GTA5.exe"))
			if err != nil {
				continue
			}
			if k := findAwcKey(exe); k != nil {
				writeJSON(w, map[string]string{"key": hex.EncodeToString(k), "exe": filepath.Join(d, "GTA5.exe")})
				return true
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"gta_exe_not_found"}`))
		return true
	case "/native/gta/sfx":
		name := r.URL.Query().Get("name")
		if !strings.EqualFold(name, "WEAPONS_PLAYER.rpf") && !strings.EqualFold(name, "RESIDENT.rpf") {
			http.Error(w, "bad name", http.StatusBadRequest)
			return true
		}
		for _, d := range gtaDirs(r) {
			b, err := os.ReadFile(filepath.Join(d, "x64", "audio", "sfx", name))
			if err != nil {
				continue
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Length", strconv.Itoa(len(b)))
			_, _ = w.Write(b)
			return true
		}
		http.Error(w, "gta_not_found", http.StatusNotFound)
		return true
	}
	return false
}

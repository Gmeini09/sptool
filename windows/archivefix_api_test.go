//go:build windows

package main

// Runs the real ArchiveFix through the endpoint. Needs two files from the developer's PC, so it only runs with
// SPTOOL_ARCHIVEFIX=<path to ArchiveFix.exe> and SPTOOL_OPEN_RPF=<an open WEAPONS_PLAYER.rpf>.

import (
	"bytes"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
)

func TestArchiveFixRun(t *testing.T) {
	exe, rpf := os.Getenv("SPTOOL_ARCHIVEFIX"), os.Getenv("SPTOOL_OPEN_RPF")
	if exe == "" || rpf == "" {
		t.Skip("SPTOOL_ARCHIVEFIX / SPTOOL_OPEN_RPF not set")
	}
	data, err := os.ReadFile(rpf)
	if err != nil {
		t.Fatal(err)
	}
	if got := findArchiveFix(exe); got != exe {
		t.Fatalf("find: %q", got)
	}
	if got := findArchiveFix(""); got == "" {
		t.Fatal("search below Desktop / Downloads / Documents found nothing")
	} else {
		t.Logf("found by search: %s", got)
	}
	if !hasArchiveFixKeys(exe) {
		t.Fatal("key files missing")
	}
	req := httptest.NewRequest(http.MethodPost, "/native/archivefix/run?exe="+url.QueryEscape(exe)+"&file=WEAPONS_PLAYER.rpf", bytes.NewReader(data))
	rec := httptest.NewRecorder()
	if !archiveFixAPI(rec, req) {
		t.Fatal("not handled")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	out := rec.Body.Bytes()
	if len(out) != len(data) {
		t.Fatalf("size %d != %d", len(out), len(data))
	}
	if enc := binary.LittleEndian.Uint32(out[12:16]); enc != 0x0fefffff {
		t.Fatalf("encryption 0x%08x, want NG 0x0fefffff", enc)
	}
	tocEnd := 16 + int(binary.LittleEndian.Uint32(data[4:8]))*16 + int(binary.LittleEndian.Uint32(data[8:12]))
	start := (tocEnd + 511) / 512 * 512
	if !bytes.Equal(out[start:], data[start:]) {
		t.Fatal("file data changed")
	}
}

func TestArchiveFixRejects(t *testing.T) {
	for _, q := range []string{"exe=C:/Windows/notepad.exe&file=WEAPONS_PLAYER.rpf", "exe=x/ArchiveFix.exe&file=other.rpf"} {
		rec := httptest.NewRecorder()
		archiveFixAPI(rec, httptest.NewRequest(http.MethodPost, "/native/archivefix/run?"+q, bytes.NewReader(make([]byte, 32))))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: status %d", q, rec.Code)
		}
	}
}

package main

import (
	"crypto/sha1"
	"bytes"
	"os"
	"testing"
)

// Runs only with SPTOOL_GTA_EXE set (the player's own GTA5.exe – never part of the repository).
func TestFindAwcKey(t *testing.T) {
	p := os.Getenv("SPTOOL_GTA_EXE")
	if p == "" {
		t.Skip("SPTOOL_GTA_EXE not set")
	}
	exe, err := os.ReadFile(p)
	if err != nil {
		t.Skip(err)
	}
	k := findAwcKey(exe)
	if k == nil {
		t.Fatal("key not found")
	}
	h := sha1.Sum(k)
	if !bytes.Equal(h[:], awcKeySHA1) {
		t.Fatal("wrong key")
	}
}

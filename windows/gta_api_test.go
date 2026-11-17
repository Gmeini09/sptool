package main

import (
	"bytes"
	"crypto/sha1"
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
	a := findAesKey(exe)
	if len(a) != 32 {
		t.Fatal("AES key not found")
	}
	if ha := sha1.Sum(a); !bytes.Equal(ha[:], aesKeySHA1) {
		t.Fatal("wrong AES key")
	}
}

package apppkg

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestBuildAppPackage(t *testing.T) {
	exe := filepath.Join(t.TempDir(), "SPTool.exe")
	if err := os.WriteFile(exe, []byte("MZ fake exe"), 0o644); err != nil {
		t.Fatal(err)
	}
	data, err := Build(exe, "9.9.9")
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		got[f.Name] = string(b)
	}
	if got["Turbo Designs SP Tool/SPTool.exe"] != "MZ fake exe" {
		t.Fatalf("exe missing: %v", got)
	}
	if !bytes.Contains([]byte(got["Turbo Designs SP Tool/LIES MICH.txt"]), []byte("Version 9.9.9")) {
		t.Fatal("readme missing version")
	}
}

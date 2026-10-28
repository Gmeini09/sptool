package updatepkg

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func mkzip(t *testing.T, name string, body []byte) ([]byte, string) {
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	w, _ := zw.Create(name)
	_, _ = w.Write(body)
	_ = zw.Close()
	s := sha256.Sum256(b.Bytes())
	return b.Bytes(), hex.EncodeToString(s[:])
}

func TestNewer(t *testing.T) {
	cases := []struct{ a, b string; want bool }{{"1.7.0", "1.6.0", true}, {"1.6.0", "1.6.0", false}, {"1.10.0", "1.9.9", true}, {"1.5.9", "1.6.0", false}, {"x", "1.0.0", false}, {"1.0.0", "dev", true}}
	for _, c := range cases {
		if Newer(c.a, c.b) != c.want {
			t.Errorf("Newer(%s,%s) != %v", c.a, c.b, c.want)
		}
	}
}

func TestExtract(t *testing.T) {
	dir := t.TempDir()
	z, sum := mkzip(t, "Turbo Designs SP Tool/SPTool.exe", append([]byte("MZ"), make([]byte, 100)...))
	p, err := Extract(z, sum, "1.7.0", "1.6.0", dir)
	if err != nil || p != filepath.Join(dir, "1.7.0", "SPTool.exe") {
		t.Fatalf("extract: %v %s", err, p)
	}
	if b, _ := os.ReadFile(p); len(b) != 102 {
		t.Fatal("content")
	}
	if _, err := Extract(z, "00"+sum[2:], "1.7.0", "1.6.0", dir); err != ErrHash {
		t.Fatal("hash not checked")
	}
	if _, err := Extract(z, sum, "1.6.0", "1.6.0", dir); err != ErrVersion {
		t.Fatal("downgrade allowed")
	}
	if _, err := Extract(z, sum, "../../evil", "dev", dir); err != ErrVersion {
		t.Fatal("bad version accepted as folder name")
	}
	z2, s2 := mkzip(t, "x/readme.txt", []byte("hi"))
	if _, err := Extract(z2, s2, "1.7.0", "1.6.0", dir); err != ErrNoExe {
		t.Fatal("missing exe not detected")
	}
	z3, s3 := mkzip(t, "SPTool.exe", []byte("not a program"))
	if _, err := Extract(z3, s3, "1.7.0", "1.6.0", dir); err != ErrNotExe {
		t.Fatal("non-PE accepted")
	}
}

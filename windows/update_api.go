package main

// POST /native/update – in-app update. The web app downloads the newest release ZIP from the license server
// (only with an active license) and hands it over here. We check the SHA-256 the server announced, refuse
// downgrades, extract SPTool.exe into the data folder and start it: the new exe installs itself over the old
// one (closing this instance) and starts again. Projects and settings stay where they are.

import (
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"sptool/windows/installer"
	"sptool/windows/updatepkg"
)

const maxUpdateZip = 40 << 20

func updateDir() string { return filepath.Join(dataDir, "update") }

func updateAPI(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != "/native/update" {
		return false
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return true
	}
	if installer.Busy(dataDir) {
		http.Error(w, "Gerade läuft eine Installation – bitte warte, bis sie fertig ist.", http.StatusConflict)
		return true
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, maxUpdateZip+1))
	if err != nil || len(data) > maxUpdateZip {
		http.Error(w, "Update zu groß oder unvollständig.", http.StatusBadRequest)
		return true
	}
	exe, err := updatepkg.Extract(data, r.Header.Get("X-SPTool-SHA256"), r.Header.Get("X-SPTool-Version"), version, updateDir())
	if err != nil {
		log.Println("update rejected:", err)
		http.Error(w, "Update abgelehnt: "+err.Error(), http.StatusUnprocessableEntity)
		return true
	}
	log.Println("update ready:", exe)
	w.WriteHeader(http.StatusAccepted)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	go func() {
		time.Sleep(600 * time.Millisecond) // let the answer reach the window first
		_ = os.Remove(sessionMarker())      // the update closes this instance on purpose
		if err := exec.Command(exe).Start(); err != nil {
			log.Println("update start failed:", err)
		}
	}()
	return true
}

// cleanOldUpdates removes extracted updates once the installed copy runs (they are only needed for the hand-over).
func cleanOldUpdates() {
	self, err := os.Executable()
	if err != nil || filepath.Dir(self) == updateDir() || filepath.Dir(filepath.Dir(self)) == updateDir() {
		return
	}
	go func() {
		time.Sleep(20 * time.Second)
		_ = os.RemoveAll(updateDir())
	}()
}

package main

// GET /native/app-package returns this SP Tool build as the distribution ZIP.
// An admin's app hands it to the license server so every key DM carries the newest version.

import (
	"net/http"
	"os"

	"sptool/windows/apppkg"
)

func appPackageAPI(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != "/native/app-package" {
		return false
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return true
	}
	if version == "dev" {
		http.Error(w, "development build", http.StatusConflict)
		return true
	}
	exePath, err := os.Executable()
	if err != nil {
		http.Error(w, "executable not found", http.StatusInternalServerError)
		return true
	}
	data, err := apppkg.Build(exePath, version)
	if err != nil {
		http.Error(w, "could not package the app", http.StatusInternalServerError)
		return true
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-SPTool-Version", version)
	_, _ = w.Write(data)
	return true
}

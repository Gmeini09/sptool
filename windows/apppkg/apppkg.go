// Package apppkg builds the SP Tool distribution ZIP (Turbo_Designs_SP_Tool.zip) from an SPTool.exe.
package apppkg

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"strings"
	"time"
)

const appZipFolder = "Turbo Designs SP Tool/"

func readmeText(v string) string {
	return strings.Join([]string{
		"SP Tool von Turbo Design - Version " + v,
		"",
		"1. ZIP entpacken.",
		"2. SPTool.exe doppelklicken (installiert/aktualisiert und startet SP Tool).",
		"3. Windows-Warnung: \"Weitere Informationen\" -> \"Trotzdem ausfuehren\".",
		"4. Mit Discord anmelden und deinen Lizenz-Key eingeben.",
		"   Die Lizenz wird an deine Discord-ID und deinen PC (Hardware-ID) gebunden.",
		"",
		"Update: einfach die neue SPTool.exe starten - Projekte und Einstellungen bleiben erhalten.",
		"",
	}, "\r\n")
}

// Build returns the ZIP: "Turbo Designs SP Tool/SPTool.exe" + "LIES MICH.txt".
func Build(exePath, v string) ([]byte, error) {
	exe, err := os.Open(exePath)
	if err != nil {
		return nil, err
	}
	defer exe.Close()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	now := time.Now()
	add := func(name string, r io.Reader) error {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: now})
		if err != nil {
			return err
		}
		_, err = io.Copy(w, r)
		return err
	}
	if err := add(appZipFolder+"SPTool.exe", exe); err != nil {
		return nil, err
	}
	if err := add(appZipFolder+"LIES MICH.txt", strings.NewReader(readmeText(v))); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

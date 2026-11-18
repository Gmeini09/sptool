//go:build windows

package main

// Windows' own folder dialog (IFileOpenDialog with FOS_PICKFOLDERS) – the big Explorer-style window with the
// navigation pane, address bar and search, not the small tree of the old FolderBrowserDialog. Plain COM via syscall,
// no extra dependency; it runs on its own locked OS thread (STA) and is owned by the SP Tool window.

import (
	"errors"
	"runtime"
	"syscall"
	"unsafe"
)

var (
	mainHwnd uintptr

	modOle32                     = syscall.NewLazyDLL("ole32.dll")
	pCoInitializeEx              = modOle32.NewProc("CoInitializeEx")
	pCoUninitialize              = modOle32.NewProc("CoUninitialize")
	pCoCreateInstance            = modOle32.NewProc("CoCreateInstance")
	pCoTaskMemFree               = modOle32.NewProc("CoTaskMemFree")
	pSHCreateItemFromParsingName = syscall.NewLazyDLL("shell32.dll").NewProc("SHCreateItemFromParsingName")
	clsidFileOpenDialog          = comGUID{0xDC1C5A9C, 0xE88A, 0x4DDE, [8]byte{0xA5, 0xA1, 0x60, 0xF8, 0x2A, 0x20, 0xAE, 0xF7}}
	iidFileOpenDialog            = comGUID{0xD57C7288, 0xD4AD, 0x4768, [8]byte{0xBE, 0x02, 0x9D, 0x96, 0x95, 0x32, 0xD9, 0x60}}
	iidShellItem                 = comGUID{0x43826D1E, 0xE718, 0x42EE, [8]byte{0xBC, 0x55, 0xA1, 0xE2, 0x61, 0xC3, 0x7B, 0xFE}}
)

type comGUID struct {
	d1     uint32
	d2, d3 uint16
	d4     [8]byte
}

const (
	clsctxInproc       = 1
	fosPickFolders     = 0x20
	fosForceFileSystem = 0x40
	fosPathMustExist   = 0x800
	sigdnFileSysPath   = 0x80058000
	hrCancelled        = 0x800704C7 // HRESULT_FROM_WIN32(ERROR_CANCELLED)
	rpcEChangedMode    = 0x80010106

	// vtable slots: IUnknown 0–2, IModalWindow::Show 3, IFileDialog …
	vtRelease       = 2
	vtShow          = 3
	vtSetOptions    = 9
	vtGetOptions    = 10
	vtSetFolder     = 12
	vtSetTitle      = 17
	vtSetOkLabel    = 18
	vtGetResult     = 20
	vtGetDisplayNam = 5 // IShellItem::GetDisplayName
)

// comObj is a COM interface pointer: its first field points at the method table.
type comObj struct{ vtbl *[32]uintptr }

// comCall calls method `slot` of the COM object `obj`.
func comCall(obj *comObj, slot int, args ...uintptr) uint32 {
	r, _, _ := syscall.SyscallN(obj.vtbl[slot], append([]uintptr{uintptr(unsafe.Pointer(obj))}, args...)...)
	return uint32(r)
}

func utf16At(p *uint16) string {
	if p == nil {
		return ""
	}
	var s []uint16
	for q := unsafe.Pointer(p); *(*uint16)(q) != 0; q = unsafe.Add(q, 2) {
		s = append(s, *(*uint16)(q))
	}
	return syscall.UTF16ToString(s)
}

// pickFolderNative shows the Explorer-style folder dialog; "" when cancelled.
func pickFolderNative(title, okLabel, initial string) (string, error) {
	type res struct {
		path string
		err  error
	}
	ch := make(chan res, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		hr, _, _ := pCoInitializeEx.Call(0, 0x2|0x4) // COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE
		if uint32(hr) != rpcEChangedMode {
			defer pCoUninitialize.Call()
		}
		var dlg *comObj
		if r, _, _ := pCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidFileOpenDialog)), 0, clsctxInproc,
			uintptr(unsafe.Pointer(&iidFileOpenDialog)), uintptr(unsafe.Pointer(&dlg))); int32(r) < 0 || dlg == nil {
			ch <- res{err: errors.New("Der Ordner-Dialog von Windows ist nicht verfügbar.")}
			return
		}
		defer comCall(dlg, vtRelease)

		var opts uint32
		comCall(dlg, vtGetOptions, uintptr(unsafe.Pointer(&opts)))
		comCall(dlg, vtSetOptions, uintptr(opts|fosPickFolders|fosForceFileSystem|fosPathMustExist))
		if t, err := syscall.UTF16PtrFromString(title); err == nil {
			comCall(dlg, vtSetTitle, uintptr(unsafe.Pointer(t)))
		}
		if t, err := syscall.UTF16PtrFromString(okLabel); err == nil {
			comCall(dlg, vtSetOkLabel, uintptr(unsafe.Pointer(t)))
		}
		if initial != "" {
			if p, err := syscall.UTF16PtrFromString(initial); err == nil {
				var item *comObj
				if r, _, _ := pSHCreateItemFromParsingName.Call(uintptr(unsafe.Pointer(p)), 0, uintptr(unsafe.Pointer(&iidShellItem)), uintptr(unsafe.Pointer(&item))); int32(r) >= 0 && item != nil {
					comCall(dlg, vtSetFolder, uintptr(unsafe.Pointer(item)))
					comCall(item, vtRelease)
				}
			}
		}

		switch hr := comCall(dlg, vtShow, mainHwnd); {
		case hr == hrCancelled:
			ch <- res{}
			return
		case int32(hr) < 0:
			ch <- res{err: errors.New("Der Ordner-Dialog konnte nicht geöffnet werden.")}
			return
		}
		var item *comObj
		if hr := comCall(dlg, vtGetResult, uintptr(unsafe.Pointer(&item))); int32(hr) < 0 || item == nil {
			ch <- res{}
			return
		}
		defer comCall(item, vtRelease)
		var name *uint16
		if hr := comCall(item, vtGetDisplayNam, sigdnFileSysPath, uintptr(unsafe.Pointer(&name))); int32(hr) < 0 {
			ch <- res{err: errors.New("Dieser Ordner liegt nicht auf einem Laufwerk – bitte einen normalen Ordner wählen.")}
			return
		}
		path := utf16At(name)
		pCoTaskMemFree.Call(uintptr(unsafe.Pointer(name)))
		ch <- res{path: path}
	}()
	r := <-ch
	return r.path, r.err
}

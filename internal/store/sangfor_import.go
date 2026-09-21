package store

import (
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/xuri/excelize/v2"
)

type SangforImportItem struct {
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Detail string `json:"detail"`
	Action string `json:"action"`
}

type SangforImportPreview struct {
	ServersCreated int                 `json:"servers_created"`
	ServersUpdated int                 `json:"servers_updated"`
	AppsCreated    int                 `json:"apps_created"`
	AppsUpdated    int                 `json:"apps_updated"`
	Conflicts      int                 `json:"conflicts"`
	HiddenSecrets  int                 `json:"hidden_secrets"`
	Items          []SangforImportItem `json:"items"`
}

type sangforServer struct {
	Name, Location, Remark, MgmtIP string
}

type sangforApp struct {
	Name, IP, Remark string
}

func cleanCell(v string) string { return strings.TrimSpace(strings.ReplaceAll(v, "\n", " ")) }

var numericOnly = regexp.MustCompile(`^[0-9]+$`)

func isPhysicalDeviceName(v string) bool {
	v = cleanCell(v)
	if v == "" || numericOnly.MatchString(v) || strings.HasPrefix(strings.ToUpper(v), "VLAN") {
		return false
	}
	return true
}

func stripSecret(v string) string {
	parts := strings.Fields(v)
	kept := parts[:0]
	for _, part := range parts {
		lower := strings.ToLower(part)
		if strings.Contains(part, "/") && (strings.Contains(lower, "admin") || strings.Contains(lower, "sangfor")) {
			continue
		}
		kept = append(kept, part)
	}
	return strings.TrimSpace(strings.Join(kept, " "))
}

func parseSangfor(r io.Reader) ([]sangforServer, []sangforApp, int, error) {
	f, err := excelize.OpenReader(r)
	if err != nil {
		return nil, nil, 0, err
	}
	defer f.Close()
	servers := map[string]sangforServer{}
	apps := map[string]sangforApp{}
	secrets := 0
	connectionSheets := []string{"互联网云桌面", "专网云桌面", "互联网超融合", "防火墙", "准入"}
	for _, sheet := range connectionSheets {
		rows, err := f.GetRows(sheet)
		if err != nil {
			continue
		}
		business := ""
		for i, row := range rows {
			if i < 2 {
				continue
			}
			if len(row) > 0 && cleanCell(row[0]) != "" {
				business = cleanCell(row[0])
			}
			get := func(n int) string {
				if n < len(row) {
					return cleanCell(row[n])
				}
				return ""
			}
			local, loc, localPort := get(1), get(2), get(3)
			peer, peerLoc, peerPort := get(5), get(6), get(7)
			if isPhysicalDeviceName(local) {
				key := local + "|" + loc
				x := servers[key]
				x.Name, x.Location = local, loc
				x.Remark += fmt.Sprintf("%s端口%s -> %s:%s；", business, localPort, peer, peerPort)
				servers[key] = x
			}
			if isPhysicalDeviceName(peer) {
				key := peer + "|" + peerLoc
				x := servers[key]
				x.Name, x.Location = peer, peerLoc
				x.Remark += fmt.Sprintf("%s端口%s <- %s:%s；", business, peerPort, local, localPort)
				servers[key] = x
			}
		}
	}
	if rows, err := f.GetRows("管理"); err == nil {
		for i, row := range rows {
			if i < 2 {
				continue
			}
			get := func(n int) string {
				if n < len(row) {
					return cleanCell(row[n])
				}
				return ""
			}
			name, ip, cred, remark := get(1), get(2), get(3), get(4)
			if name == "" || name == "名称" {
				continue
			}
			if cred != "" {
				secrets++
			}
			apps[name+"|"+ip] = sangforApp{Name: name, IP: ip, Remark: remark + "；管理凭据已隐藏"}
		}
	}
	if rows, err := f.GetRows("其它管理平台"); err == nil {
		for _, row := range rows {
			if len(row) == 0 {
				continue
			}
			value := cleanCell(row[0])
			if value == "" {
				continue
			}
			if strings.Contains(value, "密码") || strings.Contains(value, "admin/") {
				secrets++
			}
			safeValue := stripSecret(value)
			name := safeValue
			ip := ""
			if idx := strings.Index(safeValue, "http"); idx > 0 {
				name, ip = strings.TrimSpace(safeValue[:idx]), strings.TrimSpace(safeValue[idx:])
			}
			apps[name+"|"+ip] = sangforApp{Name: name, IP: ip, Remark: "其它管理平台；管理凭据已隐藏"}
		}
	}
	var sl []sangforServer
	for _, x := range servers {
		sl = append(sl, x)
	}
	var al []sangforApp
	for _, x := range apps {
		al = append(al, x)
	}
	return sl, al, secrets, nil
}

func (s *Store) PreviewSangforImport(r io.Reader) (*SangforImportPreview, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.PreviewSangforImportForProject(scope, r)
}

func (s *Store) CommitSangforImport(r io.Reader) (*SangforImportPreview, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.CommitSangforImportForProject(scope, r)
}

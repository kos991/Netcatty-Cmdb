package store

import (
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

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
	servers, apps, secrets, err := parseSangfor(r)
	if err != nil {
		return nil, err
	}
	p := &SangforImportPreview{HiddenSecrets: secrets}
	for _, srv := range servers {
		var id int64
		err := s.db.QueryRow("SELECT id FROM servers WHERE device_name=? AND location=? LIMIT 1", srv.Name, srv.Location).Scan(&id)
		action := "新增"
		if err == nil {
			action = "更新"
		}
		p.Items = append(p.Items, SangforImportItem{Kind: "服务器", Name: srv.Name, Detail: srv.Location, Action: action})
		if action == "新增" {
			p.ServersCreated++
		} else {
			p.ServersUpdated++
		}
	}
	for _, app := range apps {
		var id int64
		err := s.db.QueryRow("SELECT id FROM server_apps WHERE app_name=? AND access_url=? LIMIT 1", app.Name, app.IP).Scan(&id)
		action := "新增"
		if err == nil {
			action = "更新"
		}
		p.Items = append(p.Items, SangforImportItem{Kind: "应用", Name: app.Name, Detail: app.IP, Action: action})
		if action == "新增" {
			p.AppsCreated++
		} else {
			p.AppsUpdated++
		}
	}
	return p, nil
}

func (s *Store) CommitSangforImport(r io.Reader) (*SangforImportPreview, error) {
	servers, apps, secrets, err := parseSangfor(r)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	p := &SangforImportPreview{HiddenSecrets: secrets}
	now := time.Now().Format("2006-01-02 15:04:05")
	serverIDs := map[string]int64{}
	for _, srv := range servers {
		var id int64
		err := tx.QueryRow("SELECT id FROM servers WHERE device_name=? AND location=? LIMIT 1", srv.Name, srv.Location).Scan(&id)
		if err == nil {
			_, err = tx.Exec("UPDATE servers SET remark=CASE WHEN remark='' THEN ? ELSE remark || ' ' || ? END, updated_at=? WHERE id=?", srv.Remark, srv.Remark, now, id)
			p.ServersUpdated++
		} else {
			res, e := tx.Exec("INSERT INTO servers(device_name, location, brand_model, status, remark, created_at, updated_at) VALUES(?,?,?,?,?,?,?)", srv.Name, srv.Location, "深信服设备", "运行中", srv.Remark, now, now)
			if e != nil {
				return nil, e
			}
			id, err = res.LastInsertId()
			p.ServersCreated++
		}
		if err != nil {
			return nil, err
		}
		serverIDs[srv.Name] = id
	}
	for _, app := range apps {
		serverID := int64(0)
		for name, id := range serverIDs {
			if strings.Contains(strings.ToLower(app.Name), strings.ToLower(name)) || strings.Contains(strings.ToLower(name), strings.ToLower(app.Name)) {
				serverID = id
				break
			}
		}
		var id int64
		err := tx.QueryRow("SELECT id FROM server_apps WHERE app_name=? AND access_url=? LIMIT 1", app.Name, app.IP).Scan(&id)
		if err == nil {
			_, err = tx.Exec("UPDATE server_apps SET remark=?, updated_at=? WHERE id=?", app.Remark, now, id)
			p.AppsUpdated++
		} else {
			_, err = tx.Exec("INSERT INTO server_apps(server_id, app_name, app_type, access_url, status, remark, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)", serverID, app.Name, "基础支撑", app.IP, "正常运行", app.Remark, now, now)
			p.AppsCreated++
		}
		if err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return p, nil
}

package store

import (
	"database/sql"
	"errors"
	"io"
	"strings"
	"time"
)

func (s *Store) PreviewSangforImportForProject(scope ProjectScope, r io.Reader) (*SangforImportPreview, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	servers, apps, secrets, err := parseSangfor(r)
	if err != nil {
		return nil, err
	}
	preview := &SangforImportPreview{HiddenSecrets: secrets}
	for _, server := range servers {
		var id int64
		err := s.db.QueryRow(`SELECT id FROM servers
			WHERE project_id=? AND device_name=? AND location=? LIMIT 1`,
			scope.ProjectID, server.Name, server.Location).Scan(&id)
		action := "新增"
		if err == nil {
			action = "更新"
		} else if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		preview.Items = append(preview.Items, SangforImportItem{Kind: "服务器", Name: server.Name, Detail: server.Location, Action: action})
		if action == "新增" {
			preview.ServersCreated++
		} else {
			preview.ServersUpdated++
		}
	}
	for _, app := range apps {
		var id int64
		err := s.db.QueryRow(`SELECT id FROM server_apps
			WHERE project_id=? AND app_name=? AND access_url=? LIMIT 1`,
			scope.ProjectID, app.Name, app.IP).Scan(&id)
		action := "新增"
		if err == nil {
			action = "更新"
		} else if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		preview.Items = append(preview.Items, SangforImportItem{Kind: "应用", Name: app.Name, Detail: app.IP, Action: action})
		if action == "新增" {
			preview.AppsCreated++
		} else {
			preview.AppsUpdated++
		}
	}
	return preview, nil
}

func (s *Store) CommitSangforImportForProject(scope ProjectScope, r io.Reader) (*SangforImportPreview, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	servers, apps, secrets, err := parseSangfor(r)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	preview := &SangforImportPreview{HiddenSecrets: secrets}
	now := time.Now().Format("2006-01-02 15:04:05")
	serverIDs := map[string]int64{}
	for _, server := range servers {
		var id int64
		err := tx.QueryRow(`SELECT id FROM servers
			WHERE project_id=? AND device_name=? AND location=? LIMIT 1`,
			scope.ProjectID, server.Name, server.Location).Scan(&id)
		switch {
		case err == nil:
			result, updateErr := tx.Exec(`UPDATE servers
				SET remark=CASE WHEN remark='' THEN ? ELSE remark || ' ' || ? END, updated_at=?
				WHERE id=? AND project_id=?`, server.Remark, server.Remark, now, id, scope.ProjectID)
			if updateErr != nil {
				return nil, updateErr
			}
			if err := requireAffected(result, "服务器不存在"); err != nil {
				return nil, err
			}
			preview.ServersUpdated++
		case errors.Is(err, sql.ErrNoRows):
			result, insertErr := tx.Exec(`INSERT INTO servers
				(project_id, device_name, location, brand_model, status, remark, created_at, updated_at)
				VALUES(?,?,?,?,?,?,?,?)`,
				scope.ProjectID, server.Name, server.Location, "深信服设备", "运行中", server.Remark, now, now)
			if insertErr != nil {
				return nil, insertErr
			}
			id, err = result.LastInsertId()
			if err != nil {
				return nil, err
			}
			preview.ServersCreated++
		default:
			return nil, err
		}
		serverIDs[server.Name] = id
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
		var status string
		err := tx.QueryRow(`SELECT id,IFNULL(status,'') FROM server_apps
			WHERE project_id=? AND app_name=? AND access_url=? LIMIT 1`,
			scope.ProjectID, app.Name, app.IP).Scan(&id, &status)
		switch {
		case err == nil:
			result, updateErr := tx.Exec(`UPDATE server_apps SET remark=?, updated_at=?
				WHERE id=? AND project_id=?`, app.Remark, now, id, scope.ProjectID)
			if updateErr != nil {
				return nil, updateErr
			}
			if err := requireAffected(result, "应用不存在"); err != nil {
				return nil, err
			}
			preview.AppsUpdated++
			if err := recordServerAppHistory(tx, scope.ProjectID, &ServerApp{ID: id, AppName: app.Name, Status: status}, "更新", status, now); err != nil {
				return nil, err
			}
		case errors.Is(err, sql.ErrNoRows):
			result, insertErr := tx.Exec(`INSERT INTO server_apps
				(project_id,server_id,app_name,app_type,access_url,status,remark,created_at,updated_at,version,description,network_type)
				VALUES(?,?,?,?,?,?,?,?,?,'','','')`,
				scope.ProjectID, serverID, app.Name, "基础支撑", app.IP, "正常运行", app.Remark, now, now)
			if insertErr != nil {
				return nil, insertErr
			}
			id, err = result.LastInsertId()
			if err != nil {
				return nil, err
			}
			preview.AppsCreated++
			if err := recordServerAppHistory(tx, scope.ProjectID, &ServerApp{ID: id, AppName: app.Name, Status: "正常运行"}, "创建", "", now); err != nil {
				return nil, err
			}
		default:
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return preview, nil
}

package store

import (
	"database/sql"
	"fmt"
)

// ServerAppLog uses the same timeline vocabulary as terminal asset history.
type ServerAppLog struct {
	ID          int64  `json:"id"`
	ProjectID   int64  `json:"project_id"`
	AppID       int64  `json:"app_id"`
	LogType     string `json:"log_type"`
	Operator    string `json:"operator"`
	Description string `json:"description"`
	LogTime     string `json:"log_time"`
}

func (s *Store) InitServerAppHistorySchema() error {
	_, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS server_app_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		project_id INTEGER NOT NULL DEFAULT 0,
		app_id INTEGER NOT NULL REFERENCES server_apps(id) ON DELETE CASCADE,
		log_type TEXT NOT NULL DEFAULT '',
		operator TEXT NOT NULL DEFAULT '',
		description TEXT NOT NULL DEFAULT '',
		log_time TEXT NOT NULL DEFAULT ''
	);
	CREATE INDEX IF NOT EXISTS idx_server_app_logs_app ON server_app_logs(project_id,app_id,log_time,id);`)
	return err
}

// 业务系统网络类型由自身业务 IP 所属地址池确认；仅当系统存有明确值时优先使用该值。
// 相关性查询使用 LIMIT 1，避免同一 IP 出现在多个地址池时放大结果行。
const serverAppNetworkTypeExpr = `COALESCE(NULLIF(app.network_type,''),(SELECT subnet.category FROM ip_pool ip
		JOIN ip_subnets subnet ON subnet.project_id=ip.project_id AND subnet.name=ip.subnet
		WHERE ip.project_id=app.project_id AND ip.ip=app.service_ip LIMIT 1),'')`

// NULL marks a pre-prototype value. Once migrated, explicit empty values stay empty
// across edits and restarts rather than being aliased back to middleware/remark.
// 迁移是系统内部回填，必须屏蔽同步触发器，否则会把既有记录的 revision 从 1 抬到 2。
func (s *Store) migrateServerAppPrototypeFields() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT OR REPLACE INTO _meta(k, v) VALUES ('cmdb_sync_apply', 'app-prototype-migration')`); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE server_apps SET
		version=COALESCE(version,middleware,''),
		description=COALESCE(description,remark,''),
		network_type=COALESCE(network_type,(SELECT subnet.category FROM ip_pool ip
			JOIN ip_subnets subnet ON subnet.project_id=ip.project_id AND subnet.name=ip.subnet
			WHERE ip.project_id=server_apps.project_id AND ip.ip=server_apps.service_ip LIMIT 1),'')
		WHERE version IS NULL OR description IS NULL OR network_type IS NULL`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM _meta WHERE k='cmdb_sync_apply'`); err != nil {
		return err
	}
	return tx.Commit()
}

const serverAppDetailSelect = `SELECT app.id,app.project_id,IFNULL(app.server_id,0),IFNULL(app.cmdb_asset_id,0),app.group_id,IFNULL(g.name,''),IFNULL(app.app_name,''),IFNULL(app.app_type,''),
	IFNULL(app.port,''),IFNULL(app.access_url,''),IFNULL(app.middleware,''),IFNULL(app.database_info,''),
	IFNULL(app.provider,''),IFNULL(app.owner,''),IFNULL(app.status,''),IFNULL(app.remark,''),IFNULL(app.created_at,''),IFNULL(app.updated_at,''),IFNULL(app.service_ip,''),
	IFNULL(app.asset_code,''),COALESCE(app.version,app.middleware,''),IFNULL(app.department,''),` + serverAppNetworkTypeExpr + `,COALESCE(app.description,app.remark,''),IFNULL(app.deployment,''),IFNULL(app.deployment_location,''),
	COALESCE(NULLIF(server.device_name,''),NULLIF(asset.name,''),''),IFNULL(app.service_ip,'')
	FROM server_apps app
	LEFT JOIN servers server ON server.id=app.server_id AND server.project_id=app.project_id
	LEFT JOIN cmdb_assets asset ON asset.id=app.cmdb_asset_id AND asset.project_id=app.project_id
	LEFT JOIN cmdb_groups g ON g.id=app.group_id AND g.project_id=app.project_id `

func scanServerAppDetail(scanner interface{ Scan(...interface{}) error }, app *ServerApp) error {
	return scanner.Scan(&app.ID, &app.ProjectID, &app.ServerID, &app.CmdbAssetID, &app.GroupID, &app.GroupName,
		&app.AppName, &app.AppType, &app.Port, &app.AccessURL, &app.Middleware, &app.DatabaseInfo, &app.Provider, &app.Owner,
		&app.Status, &app.Remark, &app.CreatedAt, &app.UpdatedAt, &app.ServiceIP,
		&app.AssetCode, &app.Version, &app.Department, &app.NetworkType, &app.Description, &app.Deployment, &app.DeploymentLocation,
		&app.ServerName, &app.ServerBizIP)
}

func (s *Store) GetAppForProject(scope ProjectScope, id int64) (*ServerApp, []ServerAppLog, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()
	var app ServerApp
	if err := scanServerAppDetail(tx.QueryRow(serverAppDetailSelect+` WHERE app.id=? AND app.project_id=?`, id, scope.ProjectID), &app); err != nil {
		return nil, nil, err
	}
	rows, err := tx.Query(`SELECT id,project_id,app_id,log_type,operator,description,log_time
		FROM server_app_logs WHERE app_id=? AND project_id=? ORDER BY log_time DESC,id DESC`, id, scope.ProjectID)
	if err != nil {
		return nil, nil, err
	}
	logs := make([]ServerAppLog, 0)
	for rows.Next() {
		var entry ServerAppLog
		if err := rows.Scan(&entry.ID, &entry.ProjectID, &entry.AppID, &entry.LogType, &entry.Operator, &entry.Description, &entry.LogTime); err != nil {
			rows.Close()
			return nil, nil, err
		}
		logs = append(logs, entry)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	return &app, logs, nil
}

func isServerAppArchived(status string) bool {
	return status == "已归档" || status == "已注销"
}

func recordServerAppHistory(tx *sql.Tx, projectID int64, app *ServerApp, action, oldStatus, now string) error {
	description := fmt.Sprintf("%s业务系统：%s", action, app.AppName)
	if oldStatus != app.Status {
		description += fmt.Sprintf("（状态：%s → %s）", oldStatus, app.Status)
	}
	_, err := tx.Exec(`INSERT INTO server_app_logs(project_id,app_id,log_type,operator,description,log_time) VALUES(?,?,?,'',?,?)`,
		projectID, app.ID, action, description, now)
	return err
}

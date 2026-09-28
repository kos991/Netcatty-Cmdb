package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

var ErrNetcattyHostAlreadyLinked = errors.New("Netcatty 主机已关联其他主资产")

type CmdbNetcattyLink struct {
	ID             int64  `json:"id"`
	ProjectID      int64  `json:"project_id"`
	SyncID         string `json:"sync_id"`
	AssetType      string `json:"asset_type"`
	AssetID        int64  `json:"asset_id"`
	AssetSyncID    string `json:"asset_sync_id"`
	AssetName      string `json:"asset_name"`
	HostID         string `json:"host_id"`
	HostName       string `json:"host_name"`
	CredentialID   string `json:"credential_id"`
	CredentialName string `json:"credential_name"`
	Protocol       string `json:"protocol"`
	Address        string `json:"address"`
	Port           int    `json:"port"`
	IsPrimary      bool   `json:"is_primary"`
	State          string `json:"state"`
	Revision       int64  `json:"revision"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

type netcattyLinkQueryRower interface {
	QueryRow(query string, args ...interface{}) *sql.Row
}

func normalizeNetcattyLinkState(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "linked", nil
	}
	switch value {
	case "linked", "unresolved":
		return value, nil
	default:
		return "", fmt.Errorf("无效的引用状态: %s", value)
	}
}

func resolveNetcattyLinkAsset(db netcattyLinkQueryRower, projectID int64, assetType string, assetID int64) (syncID, name string, err error) {
	if assetID <= 0 {
		return "", "", fmt.Errorf("请选择关联资产")
	}
	switch assetType {
	case "terminal":
		err = db.QueryRow(`SELECT sync_id,COALESCE(NULLIF(asset_code,''),NULLIF(user_name,''),printf('#%d',id)) FROM assets WHERE project_id=? AND id=? AND deleted_at IS NULL`, projectID, assetID).Scan(&syncID, &name)
	case "infrastructure":
		err = db.QueryRow(`SELECT sync_id,COALESCE(NULLIF(name,''),NULLIF(asset_code,''),printf('#%d',id)) FROM cmdb_assets WHERE project_id=? AND id=? AND deleted_at IS NULL`, projectID, assetID).Scan(&syncID, &name)
	case "application":
		err = db.QueryRow(`SELECT sync_id,COALESCE(NULLIF(app_name,''),printf('#%d',id)) FROM server_apps WHERE project_id=? AND id=? AND deleted_at IS NULL`, projectID, assetID).Scan(&syncID, &name)
	default:
		return "", "", fmt.Errorf("无效的资产类型: %s", assetType)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", fmt.Errorf("关联资产不存在: %w", ErrProjectScopedNotFound)
	}
	return syncID, name, err
}

func (s *Store) SaveCmdbNetcattyLinkForProject(scope ProjectScope, link *CmdbNetcattyLink) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if link == nil {
		return 0, fmt.Errorf("主机关联不能为空")
	}
	link.AssetType = strings.TrimSpace(link.AssetType)
	link.HostID = strings.TrimSpace(link.HostID)
	link.CredentialID = strings.TrimSpace(link.CredentialID)
	if link.HostID == "" && link.CredentialID == "" {
		return 0, fmt.Errorf("请至少选择 Netcatty 主机或钥匙串")
	}
	state, err := normalizeNetcattyLinkState(link.State)
	if err != nil {
		return 0, err
	}
	assetSyncID, assetName, err := resolveNetcattyLinkAsset(s.db, scope.ProjectID, link.AssetType, link.AssetID)
	if err != nil {
		return 0, err
	}
	link.AssetSyncID, link.AssetName, link.State = assetSyncID, assetName, state
	now := time.Now().UTC().Format(time.RFC3339Nano)
	primary := 0
	if link.IsPrimary {
		primary = 1
	}
	if link.ID > 0 {
		res, err := s.db.Exec(`UPDATE cmdb_netcatty_links SET asset_type=?,asset_id=?,asset_sync_id=?,asset_name=?,host_id=?,host_name=?,credential_id=?,credential_name=?,protocol=?,address=?,port=?,is_primary=?,state=?,revision=revision+1,updated_at=? WHERE id=? AND project_id=? AND deleted_at IS NULL`,
			link.AssetType, link.AssetID, assetSyncID, assetName, link.HostID, strings.TrimSpace(link.HostName), strings.TrimSpace(link.CredentialID), strings.TrimSpace(link.CredentialName), strings.TrimSpace(link.Protocol), strings.TrimSpace(link.Address), link.Port, primary, state, now, link.ID, scope.ProjectID)
		if err != nil {
			return 0, classifyNetcattyLinkError(err)
		}
		if count, _ := res.RowsAffected(); count == 0 {
			return 0, fmt.Errorf("主机关联不存在: %w", ErrProjectScopedNotFound)
		}
		return link.ID, nil
	}
	res, err := s.db.Exec(`INSERT INTO cmdb_netcatty_links(project_id,sync_id,asset_type,asset_id,asset_sync_id,asset_name,host_id,host_name,credential_id,credential_name,protocol,address,port,is_primary,state,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
		scope.ProjectID, uuid.NewString(), link.AssetType, link.AssetID, assetSyncID, assetName, link.HostID, strings.TrimSpace(link.HostName), strings.TrimSpace(link.CredentialID), strings.TrimSpace(link.CredentialName), strings.TrimSpace(link.Protocol), strings.TrimSpace(link.Address), link.Port, primary, state, now, now)
	if err != nil {
		return 0, classifyNetcattyLinkError(err)
	}
	return res.LastInsertId()
}

func classifyNetcattyLinkError(err error) error {
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "ux_cmdb_netcatty_primary_host") ||
		strings.Contains(message, "unique constraint failed: cmdb_netcatty_links.project_id, cmdb_netcatty_links.host_id") {
		return fmt.Errorf("%w: %v", ErrNetcattyHostAlreadyLinked, err)
	}
	return err
}

func (s *Store) ListCmdbNetcattyLinksForProject(scope ProjectScope, assetType string, assetID int64) ([]CmdbNetcattyLink, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	where := `project_id=? AND deleted_at IS NULL`
	args := []interface{}{scope.ProjectID}
	if strings.TrimSpace(assetType) != "" {
		where += ` AND asset_type=?`
		args = append(args, strings.TrimSpace(assetType))
	}
	if assetID > 0 {
		where += ` AND asset_id=?`
		args = append(args, assetID)
	}
	rows, err := s.db.Query(`SELECT id,project_id,sync_id,asset_type,asset_id,asset_sync_id,asset_name,host_id,host_name,credential_id,credential_name,protocol,address,port,is_primary,state,revision,created_at,updated_at FROM cmdb_netcatty_links WHERE `+where+` ORDER BY is_primary DESC,id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]CmdbNetcattyLink, 0)
	for rows.Next() {
		var item CmdbNetcattyLink
		var primary int
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.SyncID, &item.AssetType, &item.AssetID, &item.AssetSyncID, &item.AssetName, &item.HostID, &item.HostName, &item.CredentialID, &item.CredentialName, &item.Protocol, &item.Address, &item.Port, &primary, &item.State, &item.Revision, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.IsPrimary = primary != 0
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *Store) MarkCmdbNetcattyLinkStateForProject(scope ProjectScope, id int64, state string) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	state, err := normalizeNetcattyLinkState(state)
	if err != nil {
		return err
	}
	res, err := s.db.Exec(`UPDATE cmdb_netcatty_links SET state=?,revision=revision+1,updated_at=? WHERE project_id=? AND id=? AND deleted_at IS NULL`, state, time.Now().UTC().Format(time.RFC3339Nano), scope.ProjectID, id)
	if err != nil {
		return err
	}
	if count, _ := res.RowsAffected(); count == 0 {
		return fmt.Errorf("主机关联不存在: %w", ErrProjectScopedNotFound)
	}
	return nil
}

func (s *Store) DeleteCmdbNetcattyLinkForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	res, err := s.db.Exec(`UPDATE cmdb_netcatty_links SET deleted_at=?,revision=revision+1,updated_at=? WHERE project_id=? AND id=? AND deleted_at IS NULL`, now, now, scope.ProjectID, id)
	if err != nil {
		return err
	}
	if count, _ := res.RowsAffected(); count == 0 {
		return fmt.Errorf("主机关联不存在: %w", ErrProjectScopedNotFound)
	}
	return nil
}

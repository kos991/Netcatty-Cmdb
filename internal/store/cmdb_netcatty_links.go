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
	FollowAssetIP  bool   `json:"follow_asset_ip"`
	State          string `json:"state"`
	Revision       int64  `json:"revision"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

type netcattyLinkQueryRower interface {
	QueryRow(query string, args ...interface{}) *sql.Row
}

// 关联地址保存期望目标；原生主机保存由现有桌面桥接完成，失败时保留可重试差异。
func updateFollowingAddress(tx *sql.Tx, projectID int64, assetType string, assetID int64, oldIP, newIP string) error {
	if oldIP == "" || oldIP == newIP {
		return nil
	}
	var count int
	var names sql.NullString
	if err := tx.QueryRow(`SELECT COUNT(*),group_concat(COALESCE(NULLIF(host_name,''),host_id),'、') FROM cmdb_netcatty_links WHERE project_id=? AND asset_type=? AND asset_id=? AND address=? AND follow_asset_ip=1 AND deleted_at IS NULL`, projectID, assetType, assetID, oldIP).Scan(&count, &names); err != nil {
		return err
	}
	if count == 0 {
		return nil
	}
	if newIP == "" {
		return fmt.Errorf("IP %s 仍有跟随连接 %s，请先处理依赖", oldIP, names.String)
	}
	var shared int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM cmdb_netcatty_links a JOIN cmdb_netcatty_links b ON b.host_id=a.host_id AND b.id<>a.id AND b.deleted_at IS NULL WHERE a.project_id=? AND a.asset_type=? AND a.asset_id=? AND a.address=? AND a.follow_asset_ip=1 AND a.deleted_at IS NULL`, projectID, assetType, assetID, oldIP).Scan(&shared); err != nil {
		return err
	}
	if shared > 0 {
		return fmt.Errorf("跟随连接 %s 的主机还被其他资产引用，请先解除共享或新建独立主机", names.String)
	}
	_, err := tx.Exec(`UPDATE cmdb_netcatty_links SET address=?,updated_at=? WHERE project_id=? AND asset_type=? AND asset_id=? AND address=? AND follow_asset_ip=1 AND deleted_at IS NULL`, newIP, time.Now().UTC().Format(time.RFC3339Nano), projectID, assetType, assetID, oldIP)
	return err
}

func rejectIPFollowingDependencies(tx *sql.Tx, projectID int64, ip string) error {
	var names sql.NullString
	if err := tx.QueryRow(`SELECT group_concat(COALESCE(NULLIF(host_name,''),host_id),'、') FROM cmdb_netcatty_links WHERE project_id=? AND address=? AND follow_asset_ip=1 AND deleted_at IS NULL`, projectID, ip).Scan(&names); err != nil {
		return err
	}
	if names.Valid {
		return fmt.Errorf("IP %s 仍有跟随连接 %s，请先处理依赖", ip, names.String)
	}
	return nil
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
		res, err := s.db.Exec(`UPDATE cmdb_netcatty_links SET asset_type=?,asset_id=?,asset_sync_id=?,asset_name=?,host_id=?,host_name=?,credential_id=?,credential_name=?,protocol=?,address=?,port=?,is_primary=?,state=?,follow_asset_ip=?,revision=revision+1,updated_at=? WHERE id=? AND project_id=? AND deleted_at IS NULL`,
			link.AssetType, link.AssetID, assetSyncID, assetName, link.HostID, strings.TrimSpace(link.HostName), strings.TrimSpace(link.CredentialID), strings.TrimSpace(link.CredentialName), strings.TrimSpace(link.Protocol), strings.TrimSpace(link.Address), link.Port, primary, state, link.FollowAssetIP, now, link.ID, scope.ProjectID)
		if err != nil {
			return 0, classifyNetcattyLinkError(err)
		}
		if count, _ := res.RowsAffected(); count == 0 {
			return 0, fmt.Errorf("主机关联不存在: %w", ErrProjectScopedNotFound)
		}
		return link.ID, nil
	}
	res, err := s.db.Exec(`INSERT INTO cmdb_netcatty_links(project_id,sync_id,asset_type,asset_id,asset_sync_id,asset_name,host_id,host_name,credential_id,credential_name,protocol,address,port,is_primary,state,follow_asset_ip,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
		scope.ProjectID, uuid.NewString(), link.AssetType, link.AssetID, assetSyncID, assetName, link.HostID, strings.TrimSpace(link.HostName), strings.TrimSpace(link.CredentialID), strings.TrimSpace(link.CredentialName), strings.TrimSpace(link.Protocol), strings.TrimSpace(link.Address), link.Port, primary, state, link.FollowAssetIP, now, now)
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
	rows, err := s.db.Query(`SELECT id,project_id,sync_id,asset_type,asset_id,asset_sync_id,asset_name,host_id,host_name,credential_id,credential_name,protocol,address,port,is_primary,state,revision,created_at,updated_at,follow_asset_ip FROM cmdb_netcatty_links WHERE `+where+` ORDER BY is_primary DESC,id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]CmdbNetcattyLink, 0)
	for rows.Next() {
		var item CmdbNetcattyLink
		var primary int
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.SyncID, &item.AssetType, &item.AssetID, &item.AssetSyncID, &item.AssetName, &item.HostID, &item.HostName, &item.CredentialID, &item.CredentialName, &item.Protocol, &item.Address, &item.Port, &primary, &item.State, &item.Revision, &item.CreatedAt, &item.UpdatedAt, &item.FollowAssetIP); err != nil {
			return nil, err
		}
		item.IsPrimary = primary != 0
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *Store) CountOtherCmdbNetcattyHostReferences(scope ProjectScope, hostID, assetType string, assetID int64) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	hostID = strings.TrimSpace(hostID)
	if hostID == "" || assetType == "" || assetID <= 0 {
		return 0, fmt.Errorf("主机和当前资产不能为空")
	}
	var count int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_netcatty_links WHERE host_id=? AND deleted_at IS NULL AND NOT (project_id=? AND asset_type=? AND asset_id=?)`, hostID, scope.ProjectID, assetType, assetID).Scan(&count)
	return count, err
}

func (s *Store) SetDefaultCmdbNetcattyLinkForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var assetType, hostID string
	var assetID int64
	err = tx.QueryRow(`SELECT asset_type,asset_id,host_id FROM cmdb_netcatty_links WHERE id=? AND project_id=? AND deleted_at IS NULL`, id, scope.ProjectID).Scan(&assetType, &assetID, &hostID)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("主机关联不存在: %w", ErrProjectScopedNotFound)
	}
	if err != nil {
		return err
	}
	if hostID == "" {
		return fmt.Errorf("请选择可连接的 Netcatty 主机")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err = tx.Exec(`UPDATE cmdb_netcatty_links SET is_primary=0,revision=revision+1,updated_at=? WHERE project_id=? AND asset_type=? AND asset_id=? AND is_primary=1 AND deleted_at IS NULL`, now, scope.ProjectID, assetType, assetID); err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE cmdb_netcatty_links SET is_primary=1,revision=revision+1,updated_at=? WHERE id=? AND project_id=? AND deleted_at IS NULL`, now, id, scope.ProjectID); err != nil {
		return classifyNetcattyLinkError(err)
	}
	return tx.Commit()
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

package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// seededCreatedAt 标记程序内置的默认目录（网络类型、设备分类）。这些行由代码按固定规则生成，
// 不属于用户数据，判断“空库”时忽略。
const seededCreatedAt = "1970-01-01T00:00:00Z"

// ErrCmdbSnapshotProjectMismatch 表示云端快照属于另一个项目，且本机已有业务数据，不能自动接入。
var ErrCmdbSnapshotProjectMismatch = errors.New("同步快照不属于当前项目，且本机 Cmdb 已有数据，未自动接入云端项目")

// AdoptCmdbSnapshotProject 让新装或已清空的本机 Cmdb 接入云端快照所属项目：
// 本机项目没有任何用户数据和删除记录时，把项目稳定标识改为快照的标识，并按新标识重算内置分类标识。
// 标识已一致时直接返回；本机已有数据时返回 ErrCmdbSnapshotProjectMismatch，不合并两个项目。
func (s *Store) AdoptCmdbSnapshotProject(scope ProjectScope, snapshot *CmdbSnapshot) (bool, error) {
	if snapshot == nil || strings.TrimSpace(snapshot.ProjectSyncID) == "" {
		return false, errors.New("同步快照缺少项目稳定标识")
	}
	project, err := s.ResolveProject(scope)
	if err != nil {
		return false, err
	}
	if project.SyncID == snapshot.ProjectSyncID {
		return false, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return false, fmt.Errorf("开始接入云端项目: %w", err)
	}
	defer tx.Rollback()
	empty, err := projectHasNoUserData(tx, scope.ProjectID)
	if err != nil {
		return false, err
	}
	if !empty {
		return false, ErrCmdbSnapshotProjectMismatch
	}
	var taken int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM cmdb_projects WHERE sync_id=? AND id<>?`, snapshot.ProjectSyncID, scope.ProjectID).Scan(&taken); err != nil {
		return false, fmt.Errorf("检查云端项目标识: %w", err)
	}
	if taken > 0 {
		return false, errors.New("云端项目标识已被本机其他项目占用")
	}
	// 改标识与重算内置分类不是业务修改，不能推进修订号或写入删除记录。
	if _, err := tx.Exec(`INSERT OR REPLACE INTO _meta(k,v) VALUES('cmdb_sync_apply','adopt-project')`); err != nil {
		return false, fmt.Errorf("标记接入云端项目: %w", err)
	}
	if _, err := tx.Exec(`UPDATE cmdb_projects SET sync_id=? WHERE id=?`, snapshot.ProjectSyncID, scope.ProjectID); err != nil {
		return false, fmt.Errorf("更新项目稳定标识: %w", err)
	}
	for _, group := range defaultAssetCategories {
		for _, name := range group.names {
			if _, err := tx.Exec(`UPDATE cmdb_device_categories SET sync_id=?
				WHERE project_id=? AND asset_scope=? AND name=? AND created_at=?`,
				defaultAssetCategorySyncID(snapshot.ProjectSyncID, group.scope, name),
				scope.ProjectID, group.scope, name, seededCreatedAt); err != nil {
				return false, fmt.Errorf("重算内置分类标识: %w", err)
			}
		}
	}
	if _, err := tx.Exec(`DELETE FROM _meta WHERE k='cmdb_sync_apply'`); err != nil {
		return false, fmt.Errorf("清理接入标记: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("提交接入云端项目: %w", err)
	}
	return true, nil
}

func projectHasNoUserData(q snapshotQueryer, projectID int64) (bool, error) {
	var tombstones int
	if err := q.QueryRow(`SELECT COUNT(*) FROM cmdb_tombstones WHERE project_id=?`, projectID).Scan(&tombstones); err != nil {
		return false, fmt.Errorf("检查删除记录: %w", err)
	}
	if tombstones > 0 {
		return false, nil
	}
	for _, table := range projectScopedTables {
		query := "SELECT COUNT(*) FROM " + table + " WHERE project_id=?"
		args := []any{projectID}
		if table == "cmdb_network_types" || table == "cmdb_device_categories" {
			query += " AND created_at<>?"
			args = append(args, seededCreatedAt)
		}
		var count int
		if err := q.QueryRow(query, args...).Scan(&count); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return false, fmt.Errorf("检查 %s 是否为空: %w", table, err)
		}
		if count > 0 {
			return false, nil
		}
	}
	return true, nil
}

package store

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// CmdbLocalWipeResult 记录清空本机 Cmdb 数据的结果。
type CmdbLocalWipeResult struct {
	BackupPath           string `json:"backup_path"`
	DeletedRecords       int64  `json:"deleted_records"`
	RemovedAttachmentDir string `json:"removed_attachment_dir,omitempty"`
}

// WipeLocalCmdbData 清空本机当前项目的 Cmdb 业务数据与本地附件文件，用于宿主“清空本地数据”。
// 先做数据库安全备份；删除不写入删除记录（墓碑），也不改动云端，下次同步由空库接入云端项目后整体下载。
// 项目稳定标识改为新的随机值，让空库按云端快照的标识重新接入；内置目录按新标识重建。
func (s *Store) WipeLocalCmdbData(scope ProjectScope) (*CmdbLocalWipeResult, error) {
	project, err := s.ResolveProject(scope)
	if err != nil {
		return nil, err
	}
	attachmentRoot, err := s.AttachmentRootForProject(scope)
	if err != nil {
		return nil, err
	}
	backupPath, err := BackupDatabase(s.db, s.path)
	if err != nil {
		return nil, fmt.Errorf("清空前安全备份: %w", err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("开始清空本机 Cmdb: %w", err)
	}
	defer tx.Rollback()
	// 本地清空不是业务删除：触发器在此标记下不写墓碑，避免下次同步把云端数据一并删除。
	if _, err := tx.Exec(`INSERT OR REPLACE INTO _meta(k,v) VALUES('cmdb_sync_apply','local-wipe')`); err != nil {
		return nil, fmt.Errorf("标记清空本机 Cmdb: %w", err)
	}
	var deleted int64
	// snapshotApplyOrder 覆盖全部项目表；按逆序先删依赖方再删被引用方。
	for index := len(snapshotApplyOrder) - 1; index >= 0; index-- {
		result, err := tx.Exec("DELETE FROM "+snapshotApplyOrder[index]+" WHERE project_id=?", scope.ProjectID)
		if err != nil {
			return nil, fmt.Errorf("清空 %s: %w", snapshotApplyOrder[index], err)
		}
		affected, _ := result.RowsAffected()
		deleted += affected
	}
	if _, err := tx.Exec(`DELETE FROM cmdb_tombstones WHERE project_id=?`, scope.ProjectID); err != nil {
		return nil, fmt.Errorf("清空删除记录: %w", err)
	}
	if _, err := tx.Exec(`UPDATE cmdb_projects SET sync_id=? WHERE id=?`, uuid.NewString(), project.ID); err != nil {
		return nil, fmt.Errorf("重置项目稳定标识: %w", err)
	}
	if err := insertDefaultNetworkTypes(tx, scope.ProjectID, ""); err != nil {
		return nil, err
	}
	if err := insertDefaultAssetCategories(tx, scope.ProjectID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`DELETE FROM _meta WHERE k='cmdb_sync_apply'`); err != nil {
		return nil, fmt.Errorf("清理清空标记: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("提交清空本机 Cmdb: %w", err)
	}
	removed, err := removeLocalAttachmentFiles(attachmentRoot)
	if err != nil {
		return nil, fmt.Errorf("数据库已清空（备份：%s），本地附件删除失败: %w", backupPath, err)
	}
	return &CmdbLocalWipeResult{BackupPath: backupPath, DeletedRecords: deleted, RemovedAttachmentDir: removed}, nil
}

// removeLocalAttachmentFiles 只删除 Cmdb 自己写入的附件子目录（cas、work-orders），
// 不删除用户自定义附件目录本身及其中的其他文件。
func removeLocalAttachmentFiles(root string) (string, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return "", nil
	}
	if !filepath.IsAbs(root) {
		return "", errors.New("附件目录必须是绝对路径")
	}
	removedAny := false
	for _, name := range []string{"cas", "work-orders"} {
		target := filepath.Join(root, name)
		if _, err := os.Stat(target); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return "", err
		}
		if err := os.RemoveAll(target); err != nil {
			return "", err
		}
		removedAny = true
	}
	if !removedAny {
		return "", nil
	}
	return root, nil
}

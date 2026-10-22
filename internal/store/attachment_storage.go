package store

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

type AttachmentStorageStatus struct {
	ConfiguredRoot string `json:"configured_root"`
	EffectiveRoot  string `json:"effective_root"`
	UsesDefault    bool   `json:"uses_default"`
	Writable       bool   `json:"writable"`
	FileCount      int64  `json:"file_count"`
	SizeBytes      int64  `json:"size_bytes"`
}

type AttachmentMigrationPreview struct {
	SourceRoot string `json:"source_root"`
	TargetRoot string `json:"target_root"`
	FileCount  int64  `json:"file_count"`
	SizeBytes  int64  `json:"size_bytes"`
}

type AttachmentMigrationResult struct {
	SourceRoot    string `json:"source_root"`
	TargetRoot    string `json:"target_root"`
	MigratedFiles int64  `json:"migrated_files"`
	SizeBytes     int64  `json:"size_bytes"`
}

func (s *Store) DefaultAttachmentRootForProject(scope ProjectScope) (string, error) {
	if err := scope.Validate(); err != nil {
		return "", err
	}
	root, err := s.AttachmentRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, fmt.Sprintf("project-%d", scope.ProjectID)), nil
}

func (s *Store) AttachmentRootForProject(scope ProjectScope) (string, error) {
	project, err := s.ResolveProject(scope)
	if err != nil {
		return "", err
	}
	if root := strings.TrimSpace(project.AttachmentRoot); root != "" {
		return filepath.Clean(root), nil
	}
	return s.DefaultAttachmentRootForProject(scope)
}

func attachmentWorkOrderDirectory(root string, workOrderID int64) string {
	return filepath.Join(root, "work-orders", fmt.Sprintf("work-order-%d", workOrderID))
}

func attachmentCASPath(root, contentHash string) string {
	hash := strings.ToLower(strings.TrimSpace(contentHash))
	if len(hash) < 4 {
		return filepath.Join(root, "cas", hash+".bin")
	}
	return filepath.Join(root, "cas", hash[:2], hash[2:4], hash+".bin")
}

func (s *Store) BuildAttachmentLocalPathForProject(scope ProjectScope, contentHash string) (string, error) {
	root, err := s.AttachmentRootForProject(scope)
	if err != nil {
		return "", err
	}
	return attachmentCASPath(root, contentHash), nil
}

func ensureWritableDirectory(root string) error {
	if !filepath.IsAbs(root) {
		return errors.New("附件目录必须是绝对路径")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return fmt.Errorf("创建附件目录失败: %w", err)
	}
	probe := filepath.Join(root, ".cmdb-write-probe-"+uuid.NewString())
	if err := os.WriteFile(probe, []byte("cmdb"), 0o600); err != nil {
		return fmt.Errorf("附件目录不可写: %w", err)
	}
	if err := os.Remove(probe); err != nil {
		return fmt.Errorf("清理附件目录写入探针失败: %w", err)
	}
	return nil
}

func (s *Store) attachmentStorageCounts(scope ProjectScope) (int64, int64, error) {
	if err := scope.Validate(); err != nil {
		return 0, 0, err
	}
	var count, size int64
	err := s.db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(size_bytes), 0)
		FROM cmdb_work_order_attachments WHERE project_id=?`, scope.ProjectID).Scan(&count, &size)
	return count, size, err
}

func (s *Store) GetAttachmentStorageStatus(scope ProjectScope) (*AttachmentStorageStatus, error) {
	project, err := s.ResolveProject(scope)
	if err != nil {
		return nil, err
	}
	root, err := s.AttachmentRootForProject(scope)
	if err != nil {
		return nil, err
	}
	count, size, err := s.attachmentStorageCounts(scope)
	if err != nil {
		return nil, err
	}
	writable := ensureWritableDirectory(root) == nil
	return &AttachmentStorageStatus{
		ConfiguredRoot: strings.TrimSpace(project.AttachmentRoot),
		EffectiveRoot:  root,
		UsesDefault:    strings.TrimSpace(project.AttachmentRoot) == "",
		Writable:       writable,
		FileCount:      count,
		SizeBytes:      size,
	}, nil
}

func normalizeAttachmentMigrationTarget(s *Store, scope ProjectScope, targetRoot string) (string, string, error) {
	configured := strings.TrimSpace(targetRoot)
	if configured == "" {
		root, err := s.DefaultAttachmentRootForProject(scope)
		return root, "", err
	}
	if !filepath.IsAbs(configured) {
		return "", "", errors.New("附件目录必须是绝对路径")
	}
	abs, err := filepath.Abs(configured)
	if err != nil {
		return "", "", err
	}
	return filepath.Clean(abs), filepath.Clean(abs), nil
}

func (s *Store) PreflightAttachmentStorageMigration(scope ProjectScope, targetRoot string) (*AttachmentMigrationPreview, error) {
	sourceRoot, err := s.AttachmentRootForProject(scope)
	if err != nil {
		return nil, err
	}
	target, _, err := normalizeAttachmentMigrationTarget(s, scope, targetRoot)
	if err != nil {
		return nil, err
	}
	if err := ensureWritableDirectory(target); err != nil {
		return nil, err
	}
	count, size, err := s.attachmentStorageCounts(scope)
	if err != nil {
		return nil, err
	}
	return &AttachmentMigrationPreview{SourceRoot: sourceRoot, TargetRoot: target, FileCount: count, SizeBytes: size}, nil
}

func (s *Store) attachmentsForStorageMigration(scope ProjectScope) ([]WorkOrderAttachment, error) {
	rows, err := s.db.Query(`SELECT id, project_id, work_order_id, file_name, stored_name,
		COALESCE(content_hash, ''), COALESCE(s3_key, ''), COALESCE(s3_status, 'pending'),
		COALESCE(cloud_object_id, ''), COALESCE(encryption_version, 0), COALESCE(wrapped_key, ''),
		COALESCE(wrapped_key_iv, ''), COALESCE(data_iv, ''),
		size_bytes, content_type, created_at
		FROM cmdb_work_order_attachments WHERE project_id=? ORDER BY id`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	items := make([]WorkOrderAttachment, 0)
	for rows.Next() {
		var item WorkOrderAttachment
		if err := rows.Scan(
			&item.ID, &item.ProjectID, &item.WorkOrderID, &item.FileName, &item.StoredName,
			&item.ContentHash, &item.S3Key, &item.S3Status,
			&item.CloudObjectID, &item.EncryptionVersion, &item.WrappedKey, &item.WrappedKeyIV, &item.DataIV,
			&item.SizeBytes, &item.ContentType, &item.CreatedAt,
		); err != nil {
			_ = rows.Close()
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range items {
		items[index].StoredPath, err = s.resolveAttachmentPath(&items[index])
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}

func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func copyAttachmentVerified(source, target, expectedHash string) (bool, error) {
	if info, err := os.Stat(target); err == nil {
		if info.IsDir() {
			return false, fmt.Errorf("目标附件路径是目录: %s", target)
		}
		hash, err := sha256File(target)
		if err != nil {
			return false, err
		}
		if !strings.EqualFold(hash, expectedHash) {
			return false, fmt.Errorf("目标目录存在同名但内容不同的文件: %s", target)
		}
		return false, nil
	} else if !os.IsNotExist(err) {
		return false, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return false, err
	}
	temporary := target + ".cmdb-migration-" + uuid.NewString()
	if err := copyFileAtomic(source, temporary); err != nil {
		return false, err
	}
	hash, err := sha256File(temporary)
	if err != nil {
		_ = os.Remove(temporary)
		return false, err
	}
	if !strings.EqualFold(hash, expectedHash) {
		_ = os.Remove(temporary)
		return false, fmt.Errorf("附件迁移校验失败: %s", source)
	}
	if err := os.Rename(temporary, target); err != nil {
		_ = os.Remove(temporary)
		return false, err
	}
	return true, nil
}

func (s *Store) MigrateAttachmentStorage(scope ProjectScope, targetRoot string) (*AttachmentMigrationResult, error) {
	preview, err := s.PreflightAttachmentStorageMigration(scope, targetRoot)
	if err != nil {
		return nil, err
	}
	_, configuredTarget, err := normalizeAttachmentMigrationTarget(s, scope, targetRoot)
	if err != nil {
		return nil, err
	}
	if filepath.Clean(preview.SourceRoot) == filepath.Clean(preview.TargetRoot) {
		if err := s.UpdateProjectAttachmentRoot(scope.ProjectID, configuredTarget); err != nil {
			return nil, err
		}
		return &AttachmentMigrationResult{SourceRoot: preview.SourceRoot, TargetRoot: preview.TargetRoot}, nil
	}
	items, err := s.attachmentsForStorageMigration(scope)
	if err != nil {
		return nil, err
	}
	created := make([]string, 0, len(items)*2)
	rollback := func() {
		for index := len(created) - 1; index >= 0; index-- {
			_ = os.Remove(created[index])
		}
	}
	for _, item := range items {
		if item.ContentHash == "" {
			rollback()
			return nil, fmt.Errorf("附件缺少内容哈希: %s", item.FileName)
		}
		if _, err := os.Stat(item.StoredPath); err != nil {
			rollback()
			return nil, fmt.Errorf("读取待迁移附件失败 %s: %w", item.FileName, err)
		}
		privateTarget := filepath.Join(attachmentWorkOrderDirectory(preview.TargetRoot, item.WorkOrderID), item.StoredName)
		wasCreated, err := copyAttachmentVerified(item.StoredPath, privateTarget, item.ContentHash)
		if err != nil {
			rollback()
			return nil, err
		}
		if wasCreated {
			created = append(created, privateTarget)
		}
		casTarget := attachmentCASPath(preview.TargetRoot, item.ContentHash)
		wasCreated, err = copyAttachmentVerified(item.StoredPath, casTarget, item.ContentHash)
		if err != nil {
			rollback()
			return nil, err
		}
		if wasCreated {
			created = append(created, casTarget)
		}
	}
	if err := s.UpdateProjectAttachmentRoot(scope.ProjectID, configuredTarget); err != nil {
		rollback()
		return nil, err
	}
	return &AttachmentMigrationResult{
		SourceRoot:    preview.SourceRoot,
		TargetRoot:    preview.TargetRoot,
		MigratedFiles: int64(len(items)),
		SizeBytes:     preview.SizeBytes,
	}, nil
}

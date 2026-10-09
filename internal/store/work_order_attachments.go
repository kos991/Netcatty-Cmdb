package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

type WorkOrderAttachment struct {
	ID                int64  `json:"id"`
	ProjectID         int64  `json:"project_id"`
	WorkOrderID       int64  `json:"work_order_id"`
	FileName          string `json:"file_name"`
	ContentHash       string `json:"content_hash"`
	S3Key             string `json:"s3_key"`
	S3Status          string `json:"s3_status"`
	CloudObjectID     string `json:"cloud_object_id"`
	EncryptionVersion int    `json:"encryption_version"`
	WrappedKey        string `json:"wrapped_key"`
	WrappedKeyIV      string `json:"wrapped_key_iv"`
	DataIV            string `json:"data_iv"`
	StoredName        string `json:"-"`
	StoredPath        string `json:"-"`
	SizeBytes         int64  `json:"size_bytes"`
	ContentType       string `json:"content_type"`
	CreatedAt         string `json:"created_at"`
}

type WorkOrderAttachmentCloudState struct {
	S3Status          string
	S3Key             string
	CloudObjectID     string
	EncryptionVersion int
	WrappedKey        string
	WrappedKeyIV      string
	DataIV            string
}

func (s *Store) AttachmentRoot() (string, error) {
	if strings.TrimSpace(s.path) == "" {
		return "", errors.New("当前数据库没有可用的本地附件目录")
	}
	abs, err := filepath.Abs(s.path)
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(abs), "cmdb", "attachments"), nil
}

// BuildAttachmentS3Key 生成统一的对象存储键（格式：attachments/ab/cd/abcdef...bin）
func BuildAttachmentS3Key(contentHash string) string {
	h := strings.ToLower(strings.TrimSpace(contentHash))
	if len(h) < 4 {
		return fmt.Sprintf("attachments/%s.bin", h)
	}
	return fmt.Sprintf("attachments/%s/%s/%s.bin", h[:2], h[2:4], h)
}

// BuildAttachmentLocalPath 根据内容哈希生成本地二级分级打散存储路径
func (s *Store) BuildAttachmentLocalPath(contentHash string) (string, error) {
	root, err := s.AttachmentRoot()
	if err != nil {
		return "", err
	}
	h := strings.ToLower(strings.TrimSpace(contentHash))
	if len(h) < 4 {
		return filepath.Join(root, fmt.Sprintf("%s.bin", h)), nil
	}
	return filepath.Join(root, h[:2], h[2:4], fmt.Sprintf("%s.bin", h)), nil
}

func (s *Store) stageWorkOrderAttachmentDirectory(scope ProjectScope, workOrderID int64) (string, string, error) {
	root, err := s.AttachmentRootForProject(scope)
	if err != nil {
		return "", "", err
	}
	original := attachmentWorkOrderDirectory(root, workOrderID)
	if _, err := os.Stat(original); os.IsNotExist(err) {
		legacyRoot, rootErr := s.AttachmentRoot()
		if rootErr != nil {
			return "", "", rootErr
		}
		original = filepath.Join(legacyRoot, fmt.Sprintf("project-%d", scope.ProjectID), fmt.Sprintf("work-order-%d", workOrderID))
		if _, legacyErr := os.Stat(original); os.IsNotExist(legacyErr) {
			return "", "", nil
		} else if legacyErr != nil {
			return "", "", legacyErr
		}
	} else if err != nil {
		return "", "", err
	}
	staged := original + ".deleting-" + uuid.NewString()
	if err := os.Rename(original, staged); err != nil {
		return "", "", err
	}
	return original, staged, nil
}

func restoreStagedWorkOrderAttachments(original, staged string) error {
	if staged == "" {
		return nil
	}
	return os.Rename(staged, original)
}

func removeStagedWorkOrderAttachments(staged string) error {
	if staged == "" {
		return nil
	}
	return os.RemoveAll(staged)
}

func (s *Store) SaveWorkOrderAttachmentForProject(scope ProjectScope, workOrderID int64, fileName, contentType string, source io.Reader) (*WorkOrderAttachment, error) {
	if _, err := s.GetCmdbWorkOrderForProject(scope, workOrderID); err != nil {
		return nil, err
	}
	fileName = filepath.Base(strings.TrimSpace(fileName))
	if fileName == "" || fileName == "." {
		return nil, errors.New("附件名称不能为空")
	}
	root, err := s.AttachmentRootForProject(scope)
	if err != nil {
		return nil, err
	}

	dir := attachmentWorkOrderDirectory(root, workOrderID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}

	// 1. 先写工单独立目录（保持测试与传统事务回滚的一致性），同时计算 SHA-256
	storedName := uuid.NewString() + strings.ToLower(filepath.Ext(fileName))
	storedPath := filepath.Join(dir, storedName)
	file, err := os.OpenFile(storedPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}

	hasher := sha256.New()
	tee := io.TeeReader(source, hasher)
	size, copyErr := io.Copy(file, tee)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(storedPath)
		if copyErr != nil {
			return nil, copyErr
		}
		return nil, closeErr
	}

	contentHash := hex.EncodeToString(hasher.Sum(nil))
	s3Key := BuildAttachmentS3Key(contentHash)

	// 2. 将数据同步镜像/硬链接到全局 CAS 路径（秒传去重与 S3 映射）
	casPath, err := s.BuildAttachmentLocalPathForProject(scope, contentHash)
	if err == nil {
		if err := os.MkdirAll(filepath.Dir(casPath), 0o700); err == nil {
			if _, statErr := os.Stat(casPath); statErr != nil {
				// 尝试硬链接，若不支持则拷贝
				if linkErr := os.Link(storedPath, casPath); linkErr != nil {
					_ = copyFileAtomic(storedPath, casPath)
				}
			}
		}
	}

	now := time.Now().Format("2006-01-02 15:04:05")
	result, err := s.db.Exec(`INSERT INTO cmdb_work_order_attachments(
		project_id, work_order_id, file_name, stored_name, content_hash, s3_key, s3_status, size_bytes, content_type, created_at
	) VALUES(?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
		scope.ProjectID, workOrderID, fileName, storedName, contentHash, s3Key, size, contentType, now)
	if err != nil {
		_ = os.Remove(storedPath)
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		_ = os.Remove(storedPath)
		return nil, err
	}

	return &WorkOrderAttachment{
		ID:          id,
		ProjectID:   scope.ProjectID,
		WorkOrderID: workOrderID,
		FileName:    fileName,
		ContentHash: contentHash,
		S3Key:       s3Key,
		S3Status:    "pending",
		StoredName:  storedName,
		StoredPath:  storedPath,
		SizeBytes:   size,
		ContentType: contentType,
		CreatedAt:   now,
	}, nil
}

func copyFileAtomic(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		_ = os.Remove(dst)
		return err
	}
	return nil
}

func (s *Store) resolveAttachmentPath(item *WorkOrderAttachment) (string, error) {
	scope := ProjectScope{ProjectID: item.ProjectID}
	root, err := s.AttachmentRootForProject(scope)
	if err != nil {
		return "", err
	}
	privatePath := filepath.Join(attachmentWorkOrderDirectory(root, item.WorkOrderID), item.StoredName)
	if _, statErr := os.Stat(privatePath); statErr == nil {
		return privatePath, nil
	}
	if item.ContentHash != "" {
		casPath := attachmentCASPath(root, item.ContentHash)
		if _, statErr := os.Stat(casPath); statErr == nil {
			return casPath, nil
		}
	}
	legacyRoot, err := s.AttachmentRoot()
	if err != nil {
		return "", err
	}
	legacyPrivatePath := filepath.Join(legacyRoot, fmt.Sprintf("project-%d", item.ProjectID), fmt.Sprintf("work-order-%d", item.WorkOrderID), item.StoredName)
	if _, statErr := os.Stat(legacyPrivatePath); statErr == nil {
		return legacyPrivatePath, nil
	}
	if item.ContentHash != "" {
		legacyCASPath, pathErr := s.BuildAttachmentLocalPath(item.ContentHash)
		if pathErr == nil {
			if _, statErr := os.Stat(legacyCASPath); statErr == nil {
				return legacyCASPath, nil
			}
			return attachmentCASPath(root, item.ContentHash), nil
		}
	}
	return privatePath, nil
}

func (s *Store) ListWorkOrderAttachmentsForProject(scope ProjectScope, workOrderID int64) ([]WorkOrderAttachment, error) {
	if _, err := s.GetCmdbWorkOrderForProject(scope, workOrderID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id, project_id, work_order_id, file_name, stored_name,
		COALESCE(content_hash, ''), COALESCE(s3_key, ''), COALESCE(s3_status, 'pending'),
		COALESCE(cloud_object_id, ''), COALESCE(encryption_version, 0), COALESCE(wrapped_key, ''),
		COALESCE(wrapped_key_iv, ''), COALESCE(data_iv, ''),
		size_bytes, content_type, created_at
		FROM cmdb_work_order_attachments WHERE project_id=? AND work_order_id=? ORDER BY id`, scope.ProjectID, workOrderID)
	if err != nil {
		return nil, err
	}

	list := make([]WorkOrderAttachment, 0)
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
		list = append(list, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range list {
		list[index].StoredPath, _ = s.resolveAttachmentPath(&list[index])
	}
	return list, nil
}

func (s *Store) GetWorkOrderAttachmentForProject(scope ProjectScope, workOrderID, attachmentID int64) (*WorkOrderAttachment, error) {
	var item WorkOrderAttachment
	err := s.db.QueryRow(`SELECT id, project_id, work_order_id, file_name, stored_name,
		COALESCE(content_hash, ''), COALESCE(s3_key, ''), COALESCE(s3_status, 'pending'),
		COALESCE(cloud_object_id, ''), COALESCE(encryption_version, 0), COALESCE(wrapped_key, ''),
		COALESCE(wrapped_key_iv, ''), COALESCE(data_iv, ''),
		size_bytes, content_type, created_at
		FROM cmdb_work_order_attachments WHERE id=? AND project_id=? AND work_order_id=?`, attachmentID, scope.ProjectID, workOrderID).
		Scan(
			&item.ID, &item.ProjectID, &item.WorkOrderID, &item.FileName, &item.StoredName,
			&item.ContentHash, &item.S3Key, &item.S3Status,
			&item.CloudObjectID, &item.EncryptionVersion, &item.WrappedKey, &item.WrappedKeyIV, &item.DataIV,
			&item.SizeBytes, &item.ContentType, &item.CreatedAt,
		)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("附件不存在: %w", ErrProjectScopedNotFound)
	}
	if err != nil {
		return nil, err
	}
	item.StoredPath, _ = s.resolveAttachmentPath(&item)
	return &item, nil
}

func (s *Store) UpdateWorkOrderAttachmentS3Status(scope ProjectScope, workOrderID, attachmentID int64, s3Status, s3Key string) error {
	result, err := s.db.Exec(`UPDATE cmdb_work_order_attachments SET s3_status=?, s3_key=?
		WHERE id=? AND project_id=? AND work_order_id=?`,
		s3Status, s3Key, attachmentID, scope.ProjectID, workOrderID)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return fmt.Errorf("附件不存在: %w", ErrProjectScopedNotFound)
	}
	return nil
}

func (s *Store) UpdateWorkOrderAttachmentCloudState(scope ProjectScope, workOrderID, attachmentID int64, state WorkOrderAttachmentCloudState) error {
	result, err := s.db.Exec(`UPDATE cmdb_work_order_attachments SET
		s3_status=?, s3_key=?, cloud_object_id=?, encryption_version=?, wrapped_key=?, wrapped_key_iv=?, data_iv=?
		WHERE id=? AND project_id=? AND work_order_id=?`,
		state.S3Status, state.S3Key, state.CloudObjectID, state.EncryptionVersion,
		state.WrappedKey, state.WrappedKeyIV, state.DataIV,
		attachmentID, scope.ProjectID, workOrderID)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return fmt.Errorf("附件不存在: %w", ErrProjectScopedNotFound)
	}
	return nil
}

func (s *Store) ListPendingWorkOrderAttachmentsForProject(scope ProjectScope) ([]WorkOrderAttachment, error) {
	if err := scope.Validate(); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id, project_id, work_order_id, file_name, stored_name,
		COALESCE(content_hash, ''), COALESCE(s3_key, ''), COALESCE(s3_status, 'pending'),
		COALESCE(cloud_object_id, ''), COALESCE(encryption_version, 0), COALESCE(wrapped_key, ''),
		COALESCE(wrapped_key_iv, ''), COALESCE(data_iv, ''),
		size_bytes, content_type, created_at
		FROM cmdb_work_order_attachments
		WHERE project_id=? AND COALESCE(s3_status, 'pending')<>'synced'
		ORDER BY id`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	list := make([]WorkOrderAttachment, 0)
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
		list = append(list, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range list {
		list[index].StoredPath, _ = s.resolveAttachmentPath(&list[index])
	}
	return list, nil
}

func (s *Store) DeleteWorkOrderAttachmentForProject(scope ProjectScope, workOrderID, attachmentID int64) error {
	item, err := s.GetWorkOrderAttachmentForProject(scope, workOrderID, attachmentID)
	if err != nil {
		return err
	}
	stagedPath := item.StoredPath + ".deleting-" + uuid.NewString()
	fileExists := true
	if err := os.Rename(item.StoredPath, stagedPath); os.IsNotExist(err) {
		fileExists = false
	} else if err != nil {
		return err
	}
	restoreFile := func() error {
		if !fileExists {
			return nil
		}
		return os.Rename(stagedPath, item.StoredPath)
	}
	tx, err := s.db.Begin()
	if err != nil {
		_ = restoreFile()
		return err
	}
	defer tx.Rollback()

	result, err := tx.Exec(`DELETE FROM cmdb_work_order_attachments WHERE id=? AND project_id=? AND work_order_id=?`, attachmentID, scope.ProjectID, workOrderID)
	if err != nil {
		_ = restoreFile()
		return err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		_ = restoreFile()
		return fmt.Errorf("附件不存在: %w", ErrProjectScopedNotFound)
	}
	if fileExists {
		if err := os.Remove(stagedPath); err != nil {
			if restoreErr := restoreFile(); restoreErr != nil {
				return fmt.Errorf("删除附件文件失败: %v；恢复附件失败: %w", err, restoreErr)
			}
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("附件文件已删除，但提交元数据删除失败: %w", err)
	}

	// 清理全局 CAS 文件（若无其他工单引用）
	if item.ContentHash != "" {
		var remainingRefs int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_work_order_attachments WHERE project_id=? AND content_hash=?`, scope.ProjectID, item.ContentHash).Scan(&remainingRefs)
		if remainingRefs == 0 {
			if casPath, err := s.BuildAttachmentLocalPathForProject(scope, item.ContentHash); err == nil {
				_ = os.Remove(casPath)
			}
		}
		var legacyRefs int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_work_order_attachments WHERE content_hash=?`, item.ContentHash).Scan(&legacyRefs)
		if legacyRefs == 0 {
			if legacyCASPath, err := s.BuildAttachmentLocalPath(item.ContentHash); err == nil {
				_ = os.Remove(legacyCASPath)
			}
		}
	}

	return nil
}

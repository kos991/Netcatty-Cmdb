package store

import (
	"database/sql"
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
	ID          int64  `json:"id"`
	ProjectID   int64  `json:"project_id"`
	WorkOrderID int64  `json:"work_order_id"`
	FileName    string `json:"file_name"`
	StoredName  string `json:"-"`
	StoredPath  string `json:"-"`
	SizeBytes   int64  `json:"size_bytes"`
	ContentType string `json:"content_type"`
	CreatedAt   string `json:"created_at"`
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

func (s *Store) stageWorkOrderAttachmentDirectory(scope ProjectScope, workOrderID int64) (string, string, error) {
	root, err := s.AttachmentRoot()
	if err != nil {
		return "", "", err
	}
	original := filepath.Join(root, fmt.Sprintf("project-%d", scope.ProjectID), fmt.Sprintf("work-order-%d", workOrderID))
	if _, err := os.Stat(original); os.IsNotExist(err) {
		return "", "", nil
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
	root, err := s.AttachmentRoot()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(root, fmt.Sprintf("project-%d", scope.ProjectID), fmt.Sprintf("work-order-%d", workOrderID))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	storedName := uuid.NewString() + strings.ToLower(filepath.Ext(fileName))
	storedPath := filepath.Join(dir, storedName)
	file, err := os.OpenFile(storedPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	size, copyErr := io.Copy(file, source)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(storedPath)
		if copyErr != nil {
			return nil, copyErr
		}
		return nil, closeErr
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	result, err := s.db.Exec(`INSERT INTO cmdb_work_order_attachments(project_id,work_order_id,file_name,stored_name,size_bytes,content_type,created_at)
		VALUES(?,?,?,?,?,?,?)`, scope.ProjectID, workOrderID, fileName, storedName, size, contentType, now)
	if err != nil {
		_ = os.Remove(storedPath)
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		_ = os.Remove(storedPath)
		return nil, err
	}
	return &WorkOrderAttachment{ID: id, ProjectID: scope.ProjectID, WorkOrderID: workOrderID, FileName: fileName, StoredName: storedName, StoredPath: storedPath, SizeBytes: size, ContentType: contentType, CreatedAt: now}, nil
}

func (s *Store) ListWorkOrderAttachmentsForProject(scope ProjectScope, workOrderID int64) ([]WorkOrderAttachment, error) {
	if _, err := s.GetCmdbWorkOrderForProject(scope, workOrderID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id,project_id,work_order_id,file_name,stored_name,size_bytes,content_type,created_at
		FROM cmdb_work_order_attachments WHERE project_id=? AND work_order_id=? ORDER BY id`, scope.ProjectID, workOrderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	root, err := s.AttachmentRoot()
	if err != nil {
		return nil, err
	}
	list := make([]WorkOrderAttachment, 0)
	for rows.Next() {
		var item WorkOrderAttachment
		if err := rows.Scan(&item.ID, &item.ProjectID, &item.WorkOrderID, &item.FileName, &item.StoredName, &item.SizeBytes, &item.ContentType, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.StoredPath = filepath.Join(root, fmt.Sprintf("project-%d", scope.ProjectID), fmt.Sprintf("work-order-%d", workOrderID), item.StoredName)
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *Store) GetWorkOrderAttachmentForProject(scope ProjectScope, workOrderID, attachmentID int64) (*WorkOrderAttachment, error) {
	var item WorkOrderAttachment
	err := s.db.QueryRow(`SELECT id,project_id,work_order_id,file_name,stored_name,size_bytes,content_type,created_at
		FROM cmdb_work_order_attachments WHERE id=? AND project_id=? AND work_order_id=?`, attachmentID, scope.ProjectID, workOrderID).
		Scan(&item.ID, &item.ProjectID, &item.WorkOrderID, &item.FileName, &item.StoredName, &item.SizeBytes, &item.ContentType, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("附件不存在: %w", ErrProjectScopedNotFound)
	}
	if err != nil {
		return nil, err
	}
	root, err := s.AttachmentRoot()
	if err != nil {
		return nil, err
	}
	item.StoredPath = filepath.Join(root, fmt.Sprintf("project-%d", scope.ProjectID), fmt.Sprintf("work-order-%d", workOrderID), item.StoredName)
	return &item, nil
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
	return nil
}

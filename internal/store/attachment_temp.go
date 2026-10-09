package store

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

const attachmentTempLifetime = 30 * time.Minute

type attachmentTempTarget struct {
	ProjectID int64
	Path      string
	ExpiresAt time.Time
}

func (s *Store) attachmentTempRoot() (string, error) {
	root, err := s.AttachmentRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, ".download-temp"), nil
}

func (s *Store) CreateAttachmentTempTarget(scope ProjectScope) (string, string, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return "", "", err
	}
	root, err := s.attachmentTempRoot()
	if err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", "", fmt.Errorf("创建附件临时目录失败: %w", err)
	}
	token := uuid.NewString()
	path := filepath.Join(root, token+".tmp")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", "", fmt.Errorf("创建附件临时文件失败: %w", err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return "", "", fmt.Errorf("关闭附件临时文件失败: %w", err)
	}

	now := time.Now()
	s.attachmentTempMu.Lock()
	if s.attachmentTemps == nil {
		s.attachmentTemps = make(map[string]attachmentTempTarget)
	}
	for existingToken, target := range s.attachmentTemps {
		if now.After(target.ExpiresAt) {
			delete(s.attachmentTemps, existingToken)
			_ = os.Remove(target.Path)
		}
	}
	s.attachmentTemps[token] = attachmentTempTarget{
		ProjectID: scope.ProjectID,
		Path:      path,
		ExpiresAt: now.Add(attachmentTempLifetime),
	}
	s.attachmentTempMu.Unlock()
	return token, path, nil
}

func (s *Store) consumeAttachmentTempTarget(scope ProjectScope, token string) (string, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", errors.New("缺少附件临时令牌")
	}
	s.attachmentTempMu.Lock()
	target, exists := s.attachmentTemps[token]
	if exists && target.ProjectID == scope.ProjectID {
		delete(s.attachmentTemps, token)
	}
	s.attachmentTempMu.Unlock()
	if !exists || target.ProjectID != scope.ProjectID {
		return "", errors.New("附件临时令牌无效或已使用")
	}
	if time.Now().After(target.ExpiresAt) {
		_ = os.Remove(target.Path)
		return "", errors.New("附件临时令牌已过期")
	}
	return target.Path, nil
}

func (s *Store) LocalizeWorkOrderAttachmentFromTemp(scope ProjectScope, workOrderID, attachmentID int64, token string) (*WorkOrderAttachment, error) {
	attachment, err := s.GetWorkOrderAttachmentForProject(scope, workOrderID, attachmentID)
	if err != nil {
		return nil, err
	}
	path, err := s.consumeAttachmentTempTarget(scope, token)
	if err != nil {
		return nil, err
	}
	defer os.Remove(path)

	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("读取附件临时文件失败: %w", err)
	}
	if info.IsDir() {
		return nil, errors.New("附件临时目标不是文件")
	}
	actualHash, err := sha256File(path)
	if err != nil {
		return nil, fmt.Errorf("计算附件哈希失败: %w", err)
	}
	if !strings.EqualFold(actualHash, attachment.ContentHash) {
		return nil, fmt.Errorf("附件哈希校验失败: 期望 %s，实际 %s", attachment.ContentHash, actualHash)
	}
	target, err := s.BuildAttachmentLocalPathForProject(scope, attachment.ContentHash)
	if err != nil {
		return nil, err
	}
	if _, err := copyAttachmentVerified(path, target, attachment.ContentHash); err != nil {
		return nil, fmt.Errorf("保存本地附件失败: %w", err)
	}
	attachment.StoredPath = target
	return attachment, nil
}

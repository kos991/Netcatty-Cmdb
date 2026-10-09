package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

var ErrProjectScopedNotFound = errors.New("项目内记录不存在")

// ProjectScope 是一次操作不可变的项目边界，禁止在 Store 上保存可变的当前项目。
type ProjectScope struct {
	ProjectID int64
}

func (s ProjectScope) Validate() error {
	if s.ProjectID <= 0 {
		return errors.New("缺少有效项目")
	}
	return nil
}

func (s *Store) DefaultProjectScope() (ProjectScope, error) {
	project, err := s.DefaultProject()
	if err != nil {
		return ProjectScope{}, err
	}
	return ProjectScope{ProjectID: project.ID}, nil
}

func (s *Store) ResolveProject(scope ProjectScope) (*CmdbProject, error) {
	if err := scope.Validate(); err != nil {
		return nil, err
	}
	project, err := s.GetCmdbProject(scope.ProjectID)
	if err != nil {
		return nil, err
	}
	return project, nil
}

func (s *Store) ListCmdbProjects() ([]CmdbProject, error) {
	rows, err := s.db.Query(`SELECT id, sync_id, code, name, COALESCE(attachment_root, ''), revision, created_at, updated_at, deleted_at
		FROM cmdb_projects WHERE deleted_at IS NULL ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := make([]CmdbProject, 0)
	for rows.Next() {
		project, err := scanCmdbProject(rows)
		if err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

func (s *Store) GetCmdbProject(id int64) (*CmdbProject, error) {
	if id <= 0 {
		return nil, errors.New("缺少有效项目")
	}
	project, err := scanCmdbProject(s.db.QueryRow(`SELECT id, sync_id, code, name, COALESCE(attachment_root, ''), revision, created_at, updated_at, deleted_at
		FROM cmdb_projects WHERE id = ? AND deleted_at IS NULL`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("项目不存在或已删除: %w", ErrProjectScopedNotFound)
	}
	if err != nil {
		return nil, err
	}
	return &project, nil
}

func (s *Store) CreateCmdbProject(project *CmdbProject) (*CmdbProject, error) {
	if project == nil {
		return nil, errors.New("项目不能为空")
	}
	project.Code = strings.TrimSpace(project.Code)
	project.Name = strings.TrimSpace(project.Name)
	if project.Code == "" || project.Name == "" {
		return nil, errors.New("项目编码和名称不能为空")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	syncID := strings.TrimSpace(project.SyncID)
	if syncID == "" {
		syncID = uuid.NewString()
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO cmdb_projects(sync_id, code, name, revision, created_at, updated_at)
		VALUES (?, ?, ?, 1, ?, ?)`, syncID, project.Code, project.Name, now, now)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	if err := insertDefaultNetworkTypes(tx, id, now); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetCmdbProject(id)
}

func (s *Store) UpdateCmdbProject(project *CmdbProject) error {
	if project == nil || project.ID <= 0 {
		return errors.New("缺少有效项目")
	}
	project.Code = strings.TrimSpace(project.Code)
	project.Name = strings.TrimSpace(project.Name)
	if project.Code == "" || project.Name == "" {
		return errors.New("项目编码和名称不能为空")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`UPDATE cmdb_projects SET code=?, name=?, revision=revision+1, updated_at=?
		WHERE id=? AND deleted_at IS NULL`, project.Code, project.Name, now, project.ID)
	if err != nil {
		return err
	}
	if err := requireAffected(result, "项目不存在或已删除"); err != nil {
		return fmt.Errorf("%w: %v", ErrProjectScopedNotFound, err)
	}
	return nil
}

func (s *Store) UpdateProjectAttachmentRoot(projectID int64, root string) error {
	if projectID <= 0 {
		return errors.New("缺少有效项目")
	}
	result, err := s.db.Exec(`UPDATE cmdb_projects SET attachment_root=?, updated_at=?
		WHERE id=? AND deleted_at IS NULL`, strings.TrimSpace(root), time.Now().UTC().Format(time.RFC3339Nano), projectID)
	if err != nil {
		return err
	}
	if err := requireAffected(result, "项目不存在或已删除"); err != nil {
		return fmt.Errorf("%w: %v", ErrProjectScopedNotFound, err)
	}
	return nil
}

func (s *Store) DeleteCmdbProject(id int64) error {
	if id <= 0 {
		return errors.New("缺少有效项目")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.Exec(`UPDATE cmdb_projects SET deleted_at=?, updated_at=?, revision=revision+1
		WHERE id=? AND deleted_at IS NULL`, now, now, id)
	if err != nil {
		return err
	}
	return requireAffected(result, "项目不存在或已删除")
}

func scanCmdbProject(scanner interface{ Scan(...interface{}) error }) (CmdbProject, error) {
	var project CmdbProject
	var deletedAt sql.NullString
	err := scanner.Scan(&project.ID, &project.SyncID, &project.Code, &project.Name, &project.AttachmentRoot, &project.Revision,
		&project.CreatedAt, &project.UpdatedAt, &deletedAt)
	project.DeletedAt = deletedAt.String
	return project, err
}

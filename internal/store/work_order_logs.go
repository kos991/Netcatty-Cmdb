package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type CmdbWorkOrderLog struct {
	ID          int64  `json:"id"`
	WorkOrderID int64  `json:"work_order_id"`
	Action      string `json:"action"`
	Content     string `json:"content"`
	Operator    string `json:"operator"`
	CreatedAt   string `json:"created_at"`
}

func insertWorkOrderLog(tx *sql.Tx, projectID, orderID int64, action, content, operator, now string) error {
	_, err := tx.Exec(`INSERT INTO cmdb_work_order_logs(project_id,work_order_id,action,content,operator,created_at) VALUES(?,?,?,?,?,?)`, projectID, orderID, action, content, operator, now)
	return err
}

func (s *Store) ListCmdbWorkOrderLogsForProject(scope ProjectScope, orderID int64) ([]CmdbWorkOrderLog, error) {
	if _, err := s.GetCmdbWorkOrderForProject(scope, orderID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT id,work_order_id,action,content,operator,created_at FROM cmdb_work_order_logs WHERE project_id=? AND work_order_id=? AND deleted_at IS NULL ORDER BY created_at DESC,id DESC`, scope.ProjectID, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]CmdbWorkOrderLog, 0)
	for rows.Next() {
		var item CmdbWorkOrderLog
		if err := rows.Scan(&item.ID, &item.WorkOrderID, &item.Action, &item.Content, &item.Operator, &item.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *Store) AddCmdbWorkOrderLogForProject(scope ProjectScope, orderID int64, content, operator string) (*CmdbWorkOrderLog, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, fmt.Errorf("处理记录不能为空")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRow(`SELECT 1 FROM cmdb_work_orders WHERE project_id=? AND id=? AND deleted_at IS NULL`, scope.ProjectID, orderID).Scan(&exists); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("工单不属于当前项目: %w", ErrProjectScopedNotFound)
		}
		return nil, err
	}
	item := &CmdbWorkOrderLog{WorkOrderID: orderID, Action: "添加记录", Content: content, Operator: strings.TrimSpace(operator), CreatedAt: time.Now().Format("2006-01-02 15:04:05")}
	result, err := tx.Exec(`INSERT INTO cmdb_work_order_logs(project_id,work_order_id,action,content,operator,created_at) VALUES(?,?,?,?,?,?)`, scope.ProjectID, orderID, item.Action, item.Content, item.Operator, item.CreatedAt)
	if err != nil {
		return nil, err
	}
	item.ID, err = result.LastInsertId()
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return item, nil
}

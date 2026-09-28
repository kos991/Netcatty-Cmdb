package store

import (
	"database/sql"
	"fmt"
	"time"
)

type cmdbHistoryExecutor interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
}

func appendCmdbAssetHistory(exec cmdbHistoryExecutor, projectID, assetID int64, eventType, description, operator string) error {
	if projectID <= 0 || assetID <= 0 {
		return fmt.Errorf("资产履历缺少项目或资产 ID")
	}
	if operator == "" {
		operator = "系统"
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := exec.Exec(`INSERT INTO cmdb_asset_history(project_id,asset_id,event_type,description,operator,occurred_at,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?)`, projectID, assetID, eventType, description, operator, now, now, now)
	return err
}

func (s *Store) ListCmdbAssetHistoryForProject(scope ProjectScope, assetID int64, limit int) ([]CmdbAssetHistory, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	if err := s.requireAssetInProject(s.db, scope.ProjectID, assetID); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.Query(`SELECT id,event_type,IFNULL(description,''),IFNULL(operator,''),occurred_at
		FROM cmdb_asset_history WHERE project_id=? AND asset_id=? ORDER BY occurred_at DESC,id DESC LIMIT ?`, scope.ProjectID, assetID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	history := make([]CmdbAssetHistory, 0)
	for rows.Next() {
		var item CmdbAssetHistory
		if err := rows.Scan(&item.ID, &item.Type, &item.Description, &item.Operator, &item.OccurredAt); err != nil {
			return nil, err
		}
		history = append(history, item)
	}
	return history, rows.Err()
}

package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (s *Store) ListCustomFieldsForProject(scope ProjectScope, assetClass string) ([]CustomField, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	query := `SELECT id, project_id, IFNULL(sync_id,''), field_key, field_name, field_type, IFNULL(options_json,''), asset_class,
		required, show_in_list, export_excel, sort_order, IFNULL(created_at,''), IFNULL(updated_at,'')
		FROM cmdb_custom_fields WHERE project_id = ?`
	args := []interface{}{scope.ProjectID}
	assetClass = strings.TrimSpace(assetClass)
	if assetClass != "" && assetClass != "all" && assetClass != "全部" {
		query += " AND (asset_class = 'all' OR asset_class = ?)"
		args = append(args, assetClass)
	}
	query += " ORDER BY sort_order ASC, id ASC"
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]CustomField, 0)
	for rows.Next() {
		var cf CustomField
		if err := rows.Scan(&cf.ID, &cf.ProjectID, &cf.SyncID, &cf.FieldKey, &cf.FieldName, &cf.FieldType, &cf.OptionsJSON, &cf.AssetClass, &cf.Required, &cf.ShowInList, &cf.ExportExcel, &cf.SortOrder, &cf.CreatedAt, &cf.UpdatedAt); err != nil {
			return nil, err
		}
		if cf.OptionsJSON != "" {
			_ = json.Unmarshal([]byte(cf.OptionsJSON), &cf.Options)
		}
		if cf.Options == nil {
			cf.Options = []string{}
		}
		list = append(list, cf)
	}
	return list, rows.Err()
}

func (s *Store) SaveCustomFieldForProject(scope ProjectScope, cf *CustomField) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	cf.FieldKey = strings.TrimSpace(cf.FieldKey)
	cf.FieldName = strings.TrimSpace(cf.FieldName)
	cf.FieldType = strings.TrimSpace(strings.ToLower(cf.FieldType))
	if cf.FieldKey == "" {
		return 0, fmt.Errorf("字段标识 field_key 不能为空")
	}
	if !fieldKeyRegex.MatchString(cf.FieldKey) {
		return 0, fmt.Errorf("字段标识 field_key 必须以字母开头，仅允许字母、数字和下划线，长度 2-64")
	}
	if cf.FieldName == "" {
		return 0, fmt.Errorf("字段名称 field_name 不能为空")
	}
	validTypes := map[string]bool{"text": true, "number": true, "select": true, "date": true, "boolean": true}
	if !validTypes[cf.FieldType] {
		return 0, fmt.Errorf("不支持的字段类型: %s", cf.FieldType)
	}
	if cf.AssetClass == "" {
		cf.AssetClass = "all"
	}
	if len(cf.Options) > 0 {
		bytes, _ := json.Marshal(cf.Options)
		cf.OptionsJSON = string(bytes)
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	cf.UpdatedAt = now
	if cf.ID > 0 {
		res, err := s.db.Exec(`UPDATE cmdb_custom_fields
			SET field_name = ?, field_type = ?, options_json = ?, asset_class = ?, required = ?, show_in_list = ?, export_excel = ?, sort_order = ?, updated_at = ?
			WHERE id = ? AND project_id = ?`, cf.FieldName, cf.FieldType, cf.OptionsJSON, cf.AssetClass, cf.Required, cf.ShowInList, cf.ExportExcel, cf.SortOrder, cf.UpdatedAt, cf.ID, scope.ProjectID)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return 0, fmt.Errorf("自定义字段不属于当前项目: %w", ErrProjectScopedNotFound)
		}
		cf.ProjectID = scope.ProjectID
		if err := s.db.QueryRow(`SELECT sync_id FROM cmdb_custom_fields WHERE id=? AND project_id=?`, cf.ID, scope.ProjectID).Scan(&cf.SyncID); err != nil {
			return 0, err
		}
		return cf.ID, nil
	}
	cf.CreatedAt = now
	res, err := s.db.Exec(`INSERT INTO cmdb_custom_fields
		(project_id, field_key, field_name, field_type, options_json, asset_class, required, show_in_list, export_excel, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		scope.ProjectID, cf.FieldKey, cf.FieldName, cf.FieldType, cf.OptionsJSON, cf.AssetClass, cf.Required, cf.ShowInList, cf.ExportExcel, cf.SortOrder, cf.CreatedAt, cf.UpdatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return 0, fmt.Errorf("字段标识 %s 已存在", cf.FieldKey)
		}
		return 0, err
	}
	newID, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	cf.ID = newID
	cf.ProjectID = scope.ProjectID
	if err := s.db.QueryRow(`SELECT sync_id FROM cmdb_custom_fields WHERE id=? AND project_id=?`, newID, scope.ProjectID).Scan(&cf.SyncID); err != nil {
		return newID, err
	}
	return newID, nil
}

func (s *Store) GetCustomFieldForProject(scope ProjectScope, id int64) (*CustomField, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	var cf CustomField
	err := s.db.QueryRow(`SELECT id,project_id,IFNULL(sync_id,''),field_key,field_name,field_type,IFNULL(options_json,''),asset_class,
		required,show_in_list,export_excel,sort_order,IFNULL(created_at,''),IFNULL(updated_at,'')
		FROM cmdb_custom_fields WHERE id=? AND project_id=?`, id, scope.ProjectID).Scan(
		&cf.ID, &cf.ProjectID, &cf.SyncID, &cf.FieldKey, &cf.FieldName, &cf.FieldType, &cf.OptionsJSON, &cf.AssetClass,
		&cf.Required, &cf.ShowInList, &cf.ExportExcel, &cf.SortOrder, &cf.CreatedAt, &cf.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("自定义字段不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	if err != nil {
		return nil, err
	}
	if cf.OptionsJSON != "" {
		_ = json.Unmarshal([]byte(cf.OptionsJSON), &cf.Options)
	}
	if cf.Options == nil {
		cf.Options = []string{}
	}
	return &cf, nil
}

func (s *Store) DeleteCustomFieldForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	res, err := s.db.Exec(`DELETE FROM cmdb_custom_fields WHERE id=? AND project_id=?`, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("自定义字段不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	return nil
}

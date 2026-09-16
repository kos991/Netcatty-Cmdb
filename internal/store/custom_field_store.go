package store

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// CustomField 对应 cmdb_custom_fields 表。
type CustomField struct {
	ID          int64    `json:"id"`
	FieldKey    string   `json:"field_key"`
	FieldName   string   `json:"field_name"`
	FieldType   string   `json:"field_type"` // text, number, select, date, boolean
	OptionsJSON string   `json:"options_json,omitempty"`
	Options     []string `json:"options,omitempty"`
	AssetClass  string   `json:"asset_class"` // all, physical, virtual, desktop, network, storage
	Required    int      `json:"required"`
	ShowInList  int      `json:"show_in_list"`
	ExportExcel int      `json:"export_excel"`
	SortOrder   int      `json:"sort_order"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
}

var fieldKeyRegex = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_]{1,63}$`)

// ListCustomFields 列出自定义字段定义，支持按 assetClass 筛选。
func (s *Store) ListCustomFields(assetClass string) ([]CustomField, error) {
	var query string
	var args []interface{}

	assetClass = strings.TrimSpace(assetClass)
	if assetClass != "" && assetClass != "all" && assetClass != "全部" {
		query = `SELECT id, field_key, field_name, field_type, IFNULL(options_json,''), asset_class,
			required, show_in_list, export_excel, sort_order, IFNULL(created_at,''), IFNULL(updated_at,'')
			FROM cmdb_custom_fields
			WHERE asset_class = 'all' OR asset_class = ?
			ORDER BY sort_order ASC, id ASC`
		args = append(args, assetClass)
	} else {
		query = `SELECT id, field_key, field_name, field_type, IFNULL(options_json,''), asset_class,
			required, show_in_list, export_excel, sort_order, IFNULL(created_at,''), IFNULL(updated_at,'')
			FROM cmdb_custom_fields
			ORDER BY sort_order ASC, id ASC`
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]CustomField, 0)
	for rows.Next() {
		var cf CustomField
		if err := rows.Scan(
			&cf.ID, &cf.FieldKey, &cf.FieldName, &cf.FieldType, &cf.OptionsJSON,
			&cf.AssetClass, &cf.Required, &cf.ShowInList, &cf.ExportExcel,
			&cf.SortOrder, &cf.CreatedAt, &cf.UpdatedAt,
		); err != nil {
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

// GetCustomField 读取单个自定义字段。
func (s *Store) GetCustomField(id int64) (*CustomField, error) {
	var cf CustomField
	err := s.db.QueryRow(`
		SELECT id, field_key, field_name, field_type, IFNULL(options_json,''), asset_class,
		       required, show_in_list, export_excel, sort_order, IFNULL(created_at,''), IFNULL(updated_at,'')
		FROM cmdb_custom_fields WHERE id = ?`, id).Scan(
		&cf.ID, &cf.FieldKey, &cf.FieldName, &cf.FieldType, &cf.OptionsJSON,
		&cf.AssetClass, &cf.Required, &cf.ShowInList, &cf.ExportExcel,
		&cf.SortOrder, &cf.CreatedAt, &cf.UpdatedAt,
	)
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

// SaveCustomField 保存自定义字段定义（支持新建或编辑）。
func (s *Store) SaveCustomField(cf *CustomField) (int64, error) {
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
		return 0, fmt.Errorf("不支持的字段类型: %s（仅支持 text, number, select, date, boolean）", cf.FieldType)
	}
	if cf.AssetClass == "" {
		cf.AssetClass = "all"
	}

	// 序列化 options
	if len(cf.Options) > 0 {
		bytes, _ := json.Marshal(cf.Options)
		cf.OptionsJSON = string(bytes)
	}

	now := time.Now().Format("2006-01-02 15:04:05")
	cf.UpdatedAt = now

	if cf.ID > 0 {
		res, err := s.db.Exec(`
			UPDATE cmdb_custom_fields
			SET field_name = ?, field_type = ?, options_json = ?, asset_class = ?,
			    required = ?, show_in_list = ?, export_excel = ?, sort_order = ?, updated_at = ?
			WHERE id = ?`,
			cf.FieldName, cf.FieldType, cf.OptionsJSON, cf.AssetClass,
			cf.Required, cf.ShowInList, cf.ExportExcel, cf.SortOrder, cf.UpdatedAt, cf.ID,
		)
		if err != nil {
			return 0, err
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			return 0, fmt.Errorf("自定义字段不存在")
		}
		return cf.ID, nil
	}

	// 新建
	cf.CreatedAt = now
	res, err := s.db.Exec(`
		INSERT INTO cmdb_custom_fields (field_key, field_name, field_type, options_json, asset_class, required, show_in_list, export_excel, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		cf.FieldKey, cf.FieldName, cf.FieldType, cf.OptionsJSON, cf.AssetClass,
		cf.Required, cf.ShowInList, cf.ExportExcel, cf.SortOrder, cf.CreatedAt, cf.UpdatedAt,
	)
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
	return newID, nil
}

// DeleteCustomField 删除自定义字段定义。
func (s *Store) DeleteCustomField(id int64) error {
	res, err := s.db.Exec("DELETE FROM cmdb_custom_fields WHERE id = ?", id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("自定义字段不存在")
	}
	return nil
}

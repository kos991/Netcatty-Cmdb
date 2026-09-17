package store

import (
	"regexp"
)

// CustomField 对应 cmdb_custom_fields 表。
type CustomField struct {
	ID          int64    `json:"id"`
	ProjectID   int64    `json:"project_id"`
	SyncID      string   `json:"sync_id"`
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
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.ListCustomFieldsForProject(scope, assetClass)
}

// GetCustomField 读取单个自定义字段。
func (s *Store) GetCustomField(id int64) (*CustomField, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.GetCustomFieldForProject(scope, id)
}

// SaveCustomField 保存自定义字段定义（支持新建或编辑）。
func (s *Store) SaveCustomField(cf *CustomField) (int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.SaveCustomFieldForProject(scope, cf)
}

// DeleteCustomField 删除自定义字段定义。
func (s *Store) DeleteCustomField(id int64) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeleteCustomFieldForProject(scope, id)
}

package store

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

var WorkOrderImportColumns = []string{"维护主题", "维护类型", "操作类型", "优先级", "计划维护时间", "负责人", "维护人员", "备注", "关联资产"}

type WorkOrderImportRow struct {
	Row     int    `json:"row"`
	Name    string `json:"name"`
	Valid   bool   `json:"valid"`
	Message string `json:"message"`
}

type WorkOrderImportResult struct {
	Total   int                  `json:"total"`
	Valid   int                  `json:"valid"`
	Created int                  `json:"created"`
	Rows    []WorkOrderImportRow `json:"rows"`
	Errors  []string             `json:"errors"`
}

// ImportCmdbWorkOrdersForProject uses the same initial-state and relation checks as
// normal creation. Preview is rolled back; commit writes every row or none.
func (s *Store) ImportCmdbWorkOrdersForProject(scope ProjectScope, input io.Reader, commit bool) (*WorkOrderImportResult, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	reader := csv.NewReader(input)
	reader.FieldsPerRecord = -1
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("无法读取 CSV 表头: %w", err)
	}
	aliases := map[string]string{"subject": "维护主题", "biz_type": "维护类型", "operation_type": "操作类型", "priority": "优先级", "plan_time": "计划维护时间", "owner": "负责人", "maintainer": "维护人员", "remark": "备注", "assets": "关联资产", "status": "维护状态"}
	columns := make(map[string]int, len(header))
	for index, value := range header {
		name := strings.TrimSpace(strings.TrimPrefix(value, "\ufeff"))
		if alias := aliases[name]; alias != "" {
			name = alias
		}
		if _, duplicate := columns[name]; duplicate && name != "" {
			return nil, fmt.Errorf("CSV 表头重复: %s", name)
		}
		columns[name] = index
	}
	if _, ok := columns["维护主题"]; !ok {
		return nil, fmt.Errorf("CSV 缺少维护主题列")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result := &WorkOrderImportResult{Rows: make([]WorkOrderImportRow, 0), Errors: make([]string, 0)}
	for rowNumber := 2; ; rowNumber++ {
		values, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("CSV 第 %d 行解析失败: %w", rowNumber, err)
		}
		empty := true
		for _, value := range values {
			if strings.TrimSpace(value) != "" {
				empty = false
				break
			}
		}
		if empty {
			continue
		}
		get := func(name string) string {
			index, ok := columns[name]
			if !ok || index >= len(values) {
				return ""
			}
			return strings.TrimSpace(values[index])
		}
		order := CmdbWorkOrder{Subject: get("维护主题"), BizType: get("维护类型"), OperationType: get("操作类型"), Priority: get("优先级"), PlanTime: get("计划维护时间"), Owner: get("负责人"), Maintainer: get("维护人员"), Remark: get("备注"), Status: get("维护状态")}
		row := WorkOrderImportRow{Row: rowNumber, Name: order.Subject}
		if raw := get("关联资产"); raw != "" {
			err = json.Unmarshal([]byte(raw), &order.Assets)
			if err != nil {
				err = fmt.Errorf("关联资产须为包含 asset_type、asset_id 的 JSON 数组: %w", err)
			}
		}
		if _, saveErr := tx.Exec("SAVEPOINT work_order_import_row"); saveErr != nil {
			return nil, saveErr
		}
		if err == nil {
			_, err = s.createCmdbWorkOrderInTx(tx, scope, &order)
		}
		if err != nil {
			if _, rollbackErr := tx.Exec("ROLLBACK TO work_order_import_row"); rollbackErr != nil {
				return nil, rollbackErr
			}
			row.Message = err.Error()
			result.Errors = append(result.Errors, fmt.Sprintf("第 %d 行: %s", rowNumber, row.Message))
		} else {
			row.Valid = true
			row.Message = "校验通过"
			result.Valid++
		}
		if _, err := tx.Exec("RELEASE work_order_import_row"); err != nil {
			return nil, err
		}
		result.Rows = append(result.Rows, row)
		result.Total++
	}
	if result.Total == 0 {
		return nil, fmt.Errorf("CSV 没有数据行")
	}
	if commit && len(result.Errors) == 0 {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		result.Created = result.Valid
	}
	return result, nil
}

package store

import (
	"database/sql"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// 终端自动命名：项目名称-设备简称-四位流水号，例如「法院-VDI-0001」。
// 设备简称优先取终端设备类型配置中的简称，未配置时按类型名称关键字推断。

type sqlQueryer interface {
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryRow(query string, args ...interface{}) *sql.Row
}

var terminalShortCodeRules = []struct {
	pattern *regexp.Regexp
	code    string
}{
	{regexp.MustCompile(`(?i)云桌面|云终端|云盒|盒子|vdi`), "VDI"},
	{regexp.MustCompile(`笔记本|(?i)laptop|notebook`), "NB"},
	{regexp.MustCompile(`一体机`), "AIO"},
	{regexp.MustCompile(`台式|(?i)desktop|\bpc\b`), "PC"},
	{regexp.MustCompile(`打印|(?i)printer`), "PRT"},
	{regexp.MustCompile(`扫描|(?i)scanner`), "SCN"},
	{regexp.MustCompile(`平板|(?i)pad|tablet`), "PAD"},
	{regexp.MustCompile(`显示器|(?i)monitor`), "MON"},
	{regexp.MustCompile(`手机|(?i)phone`), "MP"},
}

var shortCodePattern = regexp.MustCompile(`^[A-Za-z0-9]{1,8}$`)

// NormalizeTerminalShortCode 校验并统一简称为大写；空串表示使用默认推断。
func NormalizeTerminalShortCode(code string) (string, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return "", nil
	}
	if !shortCodePattern.MatchString(code) {
		return "", fmt.Errorf("设备简称只能是 1-8 位字母或数字")
	}
	return code, nil
}

func inferTerminalShortCode(deviceType string) string {
	for _, rule := range terminalShortCodeRules {
		if rule.pattern.MatchString(deviceType) {
			return rule.code
		}
	}
	return "DEV"
}

type terminalNamer struct {
	db          sqlQueryer
	projectID   int64
	projectName string
	codes       map[string]string
	next        map[string]int
}

// newTerminalNamer 必须在开启事务前拿到项目：连接池只有一个连接，事务内再用 s.db 查询会互锁。
func newTerminalNamer(db sqlQueryer, project *CmdbProject) *terminalNamer {
	name := strings.TrimSpace(project.Name)
	if name == "" {
		name = strings.TrimSpace(project.Code)
	}
	return &terminalNamer{db: db, projectID: project.ID, projectName: name, codes: map[string]string{}, next: map[string]int{}}
}

func (n *terminalNamer) shortCode(deviceType string) (string, error) {
	deviceType = strings.TrimSpace(deviceType)
	if code, ok := n.codes[deviceType]; ok {
		return code, nil
	}
	var code string
	err := n.db.QueryRow(`SELECT IFNULL(short_code,'') FROM cmdb_device_categories
		WHERE project_id=? AND asset_scope='terminal' AND name=? AND deleted_at IS NULL ORDER BY id LIMIT 1`, n.projectID, deviceType).Scan(&code)
	if err != nil && err != sql.ErrNoRows {
		return "", err
	}
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		code = inferTerminalShortCode(deviceType)
	}
	n.codes[deviceType] = code
	return code, nil
}

// nextName 返回下一个可用名称；流水号从项目内同前缀名称的最大序号继续，不复用已删除前的号码段之外的空洞。
func (n *terminalNamer) nextName(deviceType string) (string, error) {
	code, err := n.shortCode(deviceType)
	if err != nil {
		return "", err
	}
	prefix := n.projectName + "-" + code + "-"
	if _, ok := n.next[prefix]; !ok {
		rows, err := n.db.Query(`SELECT asset_name FROM assets WHERE project_id=? AND substr(asset_name,1,?)=?`, n.projectID, len([]rune(prefix)), prefix)
		if err != nil {
			return "", err
		}
		highest := 0
		for rows.Next() {
			var existing string
			if err := rows.Scan(&existing); err != nil {
				rows.Close()
				return "", err
			}
			if value, convErr := strconv.Atoi(strings.TrimPrefix(existing, prefix)); convErr == nil && value > highest {
				highest = value
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return "", err
		}
		rows.Close()
		n.next[prefix] = highest + 1
	}
	sequence := n.next[prefix]
	n.next[prefix] = sequence + 1
	return fmt.Sprintf("%s%04d", prefix, sequence), nil
}

// assignTerminalName 只为未填写名称的终端生成名称，手工名称保持不变。
func (n *terminalNamer) assignTerminalName(a *Asset) error {
	if strings.TrimSpace(a.AssetName) != "" {
		return nil
	}
	name, err := n.nextName(a.DeviceType)
	if err != nil {
		return err
	}
	a.AssetName = name
	return nil
}

// TerminalNameProposal 是批量补全名称的预览行。
type TerminalNameProposal struct {
	ID         int64  `json:"id"`
	AssetCode  string `json:"asset_code"`
	DeviceType string `json:"device_type"`
	UserName   string `json:"user_name"`
	Name       string `json:"name"`
}

func terminalNameProposals(db sqlQueryer, project *CmdbProject) ([]TerminalNameProposal, error) {
	namer := newTerminalNamer(db, project)
	rows, err := db.Query(`SELECT id, IFNULL(asset_code,''), IFNULL(device_type,''), IFNULL(user_name,'')
		FROM assets WHERE project_id=? AND TRIM(IFNULL(asset_name,''))='' ORDER BY id`, project.ID)
	if err != nil {
		return nil, err
	}
	proposals := make([]TerminalNameProposal, 0)
	for rows.Next() {
		var item TerminalNameProposal
		if err := rows.Scan(&item.ID, &item.AssetCode, &item.DeviceType, &item.UserName); err != nil {
			rows.Close()
			return nil, err
		}
		proposals = append(proposals, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for index := range proposals {
		name, err := namer.nextName(proposals[index].DeviceType)
		if err != nil {
			return nil, err
		}
		proposals[index].Name = name
	}
	return proposals, nil
}

// PreviewTerminalNameBackfillForProject 列出将被自动命名的终端，不写库。
func (s *Store) PreviewTerminalNameBackfillForProject(scope ProjectScope) ([]TerminalNameProposal, error) {
	project, err := s.ResolveProject(scope)
	if err != nil {
		return nil, err
	}
	return terminalNameProposals(s.db, project)
}

// ApplyTerminalNameBackfillForProject 在单个事务内为所有未命名终端写入名称。
func (s *Store) ApplyTerminalNameBackfillForProject(scope ProjectScope) (int, error) {
	project, err := s.ResolveProject(scope)
	if err != nil {
		return 0, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	proposals, err := terminalNameProposals(tx, project)
	if err != nil {
		return 0, err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	for _, item := range proposals {
		if _, err := tx.Exec(`UPDATE assets SET asset_name=?, updated_at=? WHERE id=? AND project_id=? AND TRIM(IFNULL(asset_name,''))=''`, item.Name, now, item.ID, scope.ProjectID); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(proposals), nil
}

// SetTerminalCategoryShortCodeForProject 维护终端设备类型的简称。
func (s *Store) SetTerminalCategoryShortCodeForProject(scope ProjectScope, id int64, code string) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	normalized, err := NormalizeTerminalShortCode(code)
	if err != nil {
		return err
	}
	result, err := s.db.Exec(`UPDATE cmdb_device_categories SET short_code=?, revision=revision+1, updated_at=?
		WHERE id=? AND project_id=? AND asset_scope='terminal' AND deleted_at IS NULL`, normalized, time.Now().Format("2006-01-02 15:04:05"), id, scope.ProjectID)
	if err != nil {
		return err
	}
	return requireConfigAffected(result, "终端设备类型不属于当前项目")
}

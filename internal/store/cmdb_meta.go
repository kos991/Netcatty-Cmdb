package store

import (
	"fmt"
	"strings"
	"time"
)

// CmdbOrg 对应 cmdb_orgs 表（组织维度）。
type CmdbOrg struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	ParentID  int64  `json:"parent_id"`
	SortOrder int64  `json:"sort_order"`
}

// CmdbGroup 对应 cmdb_groups 表（分组维度）。
type CmdbGroup struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	ParentID  int64  `json:"parent_id"`
	SortOrder int64  `json:"sort_order"`
}

// CmdbCategory 对应 cmdb_device_categories 表（类型维度）。
type CmdbCategory struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	ParentID  int64  `json:"parent_id"`
	SortOrder int64  `json:"sort_order"`
}

// CmdbDeviceModel 对应 cmdb_device_models 表（配置中心 → 设备模型库）。
type CmdbDeviceModel struct {
	ID          int64   `json:"id"`
	Vendor      string  `json:"vendor"`
	Model       string  `json:"model"`
	HeightU     int64   `json:"height_u"`
	RatedPowerW int64   `json:"rated_power_w"`
	MaxPowerW   int64   `json:"max_power_w"`
	WeightKG    float64 `json:"weight_kg"`
	DepthMM     int64   `json:"depth_mm"`
}

// CmdbAssetStatuses / CmdbNetZones 为实测的取值白名单。
var (
	CmdbAssetStatuses = []string{"在线", "在库", "报废", "维护中", "离线", "故障"}
	CmdbNetZones      = []string{"管理网", "业务网", "外部子系统", "内部网络", "带外 (OOB)", "未分类"}
)

func (s *Store) ListCmdbOrgs() ([]CmdbOrg, error) {
	rows, err := s.db.Query(`SELECT id, name, parent_id, sort_order FROM cmdb_orgs ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CmdbOrg, 0, 16)
	for rows.Next() {
		var v CmdbOrg
		if err := rows.Scan(&v.ID, &v.Name, &v.ParentID, &v.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) ListCmdbGroups() ([]CmdbGroup, error) {
	rows, err := s.db.Query(`SELECT id, name, parent_id, sort_order FROM cmdb_groups ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CmdbGroup, 0, 16)
	for rows.Next() {
		var v CmdbGroup
		if err := rows.Scan(&v.ID, &v.Name, &v.ParentID, &v.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) ListCmdbCategories() ([]CmdbCategory, error) {
	rows, err := s.db.Query(`SELECT id, name, parent_id, sort_order FROM cmdb_device_categories ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CmdbCategory, 0, 16)
	for rows.Next() {
		var v CmdbCategory
		if err := rows.Scan(&v.ID, &v.Name, &v.ParentID, &v.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) ListCmdbModels() ([]CmdbDeviceModel, error) {
	rows, err := s.db.Query(`SELECT id, IFNULL(vendor,''), IFNULL(model,''), height_u,
		rated_power_w, max_power_w, IFNULL(weight_kg,0), depth_mm
		FROM cmdb_device_models ORDER BY IFNULL(vendor,''), IFNULL(model,''), id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CmdbDeviceModel, 0, 16)
	for rows.Next() {
		var v CmdbDeviceModel
		if err := rows.Scan(&v.ID, &v.Vendor, &v.Model, &v.HeightU,
			&v.RatedPowerW, &v.MaxPowerW, &v.WeightKG, &v.DepthMM); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// SeedCmdbOrgsFromDepartments 把现有台账里的科室名灌入 CMDB 组织表，已存在的不重复写入。
// 返回本次实际新增的条数。
func (s *Store) SeedCmdbOrgsFromDepartments(departments []string) (int, error) {
	now := time.Now().Format("2006-01-02 15:04:05")
	added := 0
	for idx, name := range departments {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		res, err := s.db.Exec(`INSERT OR IGNORE INTO cmdb_orgs (name, parent_id, sort_order, created_at, updated_at)
			VALUES (?, 0, ?, ?, ?)`, name, idx, now, now)
		if err != nil {
			return added, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			added++
		}
	}
	return added, nil
}

// QueryCmdbModels 分页查询设备模型库（配置中心）。
func (s *Store) QueryCmdbModels(keyword string, page, pageSize int) ([]CmdbDeviceModel, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 10
	}
	clause := ""
	var args []interface{}
	if kw := strings.TrimSpace(keyword); kw != "" {
		pat := "%" + kw + "%"
		clause = " WHERE (IFNULL(vendor,'') LIKE ? OR IFNULL(model,'') LIKE ?)"
		args = append(args, pat, pat)
	}

	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM cmdb_device_models"+clause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(`SELECT id, IFNULL(vendor,''), IFNULL(model,''), height_u,
		rated_power_w, max_power_w, IFNULL(weight_kg,0), depth_mm FROM cmdb_device_models`+
		clause+` ORDER BY IFNULL(vendor,''), IFNULL(model,''), id LIMIT ? OFFSET ?`,
		append(append([]interface{}{}, args...), pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]CmdbDeviceModel, 0, pageSize)
	for rows.Next() {
		var v CmdbDeviceModel
		if err := rows.Scan(&v.ID, &v.Vendor, &v.Model, &v.HeightU,
			&v.RatedPowerW, &v.MaxPowerW, &v.WeightKG, &v.DepthMM); err != nil {
			return nil, 0, err
		}
		out = append(out, v)
	}
	return out, total, rows.Err()
}

func (s *Store) CreateCmdbModel(m *CmdbDeviceModel) (int64, error) {
	if strings.TrimSpace(m.Model) == "" {
		return 0, fmt.Errorf("型号不能为空")
	}
	if m.HeightU <= 0 {
		m.HeightU = 1
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`INSERT INTO cmdb_device_models
		(vendor, model, height_u, rated_power_w, max_power_w, weight_kg, depth_mm, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?)`,
		m.Vendor, m.Model, m.HeightU, m.RatedPowerW, m.MaxPowerW, m.WeightKG, m.DepthMM, now, now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return 0, fmt.Errorf("厂商 + 型号已存在")
		}
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) UpdateCmdbModel(m *CmdbDeviceModel) error {
	if strings.TrimSpace(m.Model) == "" {
		return fmt.Errorf("型号不能为空")
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := s.db.Exec(`UPDATE cmdb_device_models SET vendor=?, model=?, height_u=?, rated_power_w=?,
		max_power_w=?, weight_kg=?, depth_mm=?, updated_at=? WHERE id=?`,
		m.Vendor, m.Model, m.HeightU, m.RatedPowerW, m.MaxPowerW, m.WeightKG, m.DepthMM, now, m.ID)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return fmt.Errorf("厂商 + 型号已存在")
	}
	return err
}

func (s *Store) DeleteCmdbModel(id int64) error {
	_, err := s.db.Exec(`DELETE FROM cmdb_device_models WHERE id=?`, id)
	return err
}

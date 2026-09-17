package store

// CmdbOrg 对应 cmdb_orgs 表（组织维度）。
type CmdbOrg struct {
	ID        int64  `json:"id"`
	ProjectID int64  `json:"project_id"`
	SyncID    string `json:"sync_id"`
	Name      string `json:"name"`
	ParentID  int64  `json:"parent_id"`
	SortOrder int64  `json:"sort_order"`
}

// CmdbGroup 对应 cmdb_groups 表（分组维度）。
type CmdbGroup struct {
	ID        int64  `json:"id"`
	ProjectID int64  `json:"project_id"`
	SyncID    string `json:"sync_id"`
	Name      string `json:"name"`
	ParentID  int64  `json:"parent_id"`
	SortOrder int64  `json:"sort_order"`
}

// CmdbCategory 对应 cmdb_device_categories 表（类型维度）。
type CmdbCategory struct {
	ID        int64  `json:"id"`
	ProjectID int64  `json:"project_id"`
	SyncID    string `json:"sync_id"`
	Name      string `json:"name"`
	ParentID  int64  `json:"parent_id"`
	SortOrder int64  `json:"sort_order"`
}

// CmdbDeviceModel 对应 cmdb_device_models 表（配置中心 → 设备模型库）。
type CmdbDeviceModel struct {
	ID          int64   `json:"id"`
	ProjectID   int64   `json:"project_id"`
	SyncID      string  `json:"sync_id"`
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
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.ListCmdbOrgsForProject(scope)
}

func (s *Store) ListCmdbGroups() ([]CmdbGroup, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.ListCmdbGroupsForProject(scope)
}

func (s *Store) ListCmdbCategories() ([]CmdbCategory, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.ListCmdbCategoriesForProject(scope)
}

func (s *Store) ListCmdbModels() ([]CmdbDeviceModel, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.ListCmdbModelsForProject(scope)
}

// SeedCmdbOrgsFromDepartments 把现有台账里的科室名灌入 CMDB 组织表，已存在的不重复写入。
// 返回本次实际新增的条数。
func (s *Store) SeedCmdbOrgsFromDepartments(departments []string) (int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.SeedCmdbOrgsFromDepartmentsForProject(scope, departments)
}

// QueryCmdbModels 分页查询设备模型库（配置中心）。
func (s *Store) QueryCmdbModels(keyword string, page, pageSize int) ([]CmdbDeviceModel, int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, 0, err
	}
	return s.QueryCmdbModelsForProject(scope, keyword, page, pageSize)
}

func (s *Store) CreateCmdbModel(m *CmdbDeviceModel) (int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CreateCmdbModelForProject(scope, m)
}

func (s *Store) UpdateCmdbModel(m *CmdbDeviceModel) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.UpdateCmdbModelForProject(scope, m)
}

func (s *Store) DeleteCmdbModel(id int64) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeleteCmdbModelForProject(scope, id)
}

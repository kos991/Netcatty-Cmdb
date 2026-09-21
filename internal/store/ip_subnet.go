package store

import (
	"strings"
)

// ip_subnets 存放「网段定义」：名称、类别（专网/外网/内网）、网络前缀、网关、VLAN、用途。
// 注意：ip_pool 表结构不可变更，因此 ip_pool.subnet 仍以「网段名称」关联本表，
// 重命名网段时会级联更新 ip_pool.subnet，保证关联不断。
const ipSubnetSchema = `
CREATE TABLE IF NOT EXISTS ip_subnets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '专网',
    prefix TEXT,
    cidr TEXT,
    gateway TEXT,
    vlan TEXT,
    purpose TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    remark TEXT,
    created_at TEXT,
    updated_at TEXT
);
`

// InitIPSubnetSchema 幂等创建网段定义表。
func (s *Store) InitIPSubnetSchema() error {
	if _, err := s.db.Exec(ipSubnetSchema); err != nil {
		return err
	}
	return nil
}

// IPSubnet 是网段定义 + 运行时统计。
type IPSubnet struct {
	ID        int64  `json:"id"`
	ProjectID int64  `json:"project_id"`
	SyncID    string `json:"sync_id"`
	Name      string `json:"name"`
	Category  string `json:"category"`
	Prefix    string `json:"prefix"`
	CIDR      string `json:"cidr"`
	Gateway   string `json:"gateway"`
	VLAN      string `json:"vlan"`
	Purpose   string `json:"purpose"`
	SortOrder int64  `json:"sort_order"`
	Remark    string `json:"remark"`
	Total     int    `json:"total"`
	Used      int    `json:"used"`
	Free      int    `json:"free"`
	// Defined=false 表示该网段只在 ip_pool 里有数据、但还没有定义记录
	Defined bool `json:"defined"`
}

// IPSubnetCategories 是类别预设（可自定义填写其它值）。
var IPSubnetCategories = []string{"专网", "外网", "内网"}

// ipPrefixOf 取 IP 的 /24 前缀。
func ipPrefixOf(ip string) string {
	ip = strings.TrimSpace(ip)
	i := strings.LastIndex(ip, ".")
	if i < 0 || !ipPlainRe.MatchString(ip) {
		return ""
	}
	return ip[:i]
}

// ListIPSubnets 返回网段定义与统计。
// 结果 = 已定义的网段 ∪ ip_pool 中出现过但尚未定义的网段（后者 Defined=false），
// 避免有任何网段被藏起来看不见。
func (s *Store) ListIPSubnets() ([]IPSubnet, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.ListIPSubnetsForProject(scope)
}

// SeedIPSubnetsFromPool 为 ip_pool 中已存在但尚未定义的网段补建定义记录（幂等）。
func (s *Store) SeedIPSubnetsFromPool() (int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.SeedIPSubnetsFromPoolForProject(scope)
}

func (s *Store) GetIPSubnet(id int64) (*IPSubnet, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.GetIPSubnetForProject(scope, id)
}

func (s *Store) CreateIPSubnet(v *IPSubnet) (int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CreateIPSubnetForProject(scope, v)
}

// UpdateIPSubnet 更新网段定义；改名时级联更新 ip_pool.subnet，保证 IP 数据不断链。
func (s *Store) UpdateIPSubnet(v *IPSubnet) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.UpdateIPSubnetForProject(scope, v)
}

// DeleteIPSubnet 删除网段定义。该网段下仍有 IP 数据时拒绝删除，避免产生无主 IP。
func (s *Store) DeleteIPSubnet(id int64) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeleteIPSubnetForProject(scope, id)
}

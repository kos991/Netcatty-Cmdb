package store

import (
	"fmt"
	"sort"
	"strings"
	"time"
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_subnets_name ON ip_subnets(name);
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
	out := []IPSubnet{}
	index := map[string]int{}

	rows, err := s.db.Query(`SELECT id, name, IFNULL(category,''), IFNULL(prefix,''), IFNULL(cidr,''),
		IFNULL(gateway,''), IFNULL(vlan,''), IFNULL(purpose,''), sort_order, IFNULL(remark,'')
		FROM ip_subnets ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var v IPSubnet
		if err := rows.Scan(&v.ID, &v.Name, &v.Category, &v.Prefix, &v.CIDR, &v.Gateway,
			&v.VLAN, &v.Purpose, &v.SortOrder, &v.Remark); err != nil {
			rows.Close()
			return nil, err
		}
		v.Defined = true
		index[v.Name] = len(out)
		out = append(out, v)
	}
	rows.Close()

	// 统计各网段的 IP 数与占用数
	statRows, err := s.db.Query(`SELECT subnet, COUNT(*), SUM(CASE WHEN status='在用' THEN 1 ELSE 0 END)
		FROM ip_pool GROUP BY subnet`)
	if err != nil {
		return nil, err
	}
	type stat struct{ total, used int; prefix string }
	stats := map[string]*stat{}
	var statOrder []string
	for statRows.Next() {
		var name string
		var total, used int
		if err := statRows.Scan(&name, &total, &used); err != nil {
			statRows.Close()
			return nil, err
		}
		stats[name] = &stat{total: total, used: used}
		statOrder = append(statOrder, name)
	}
	statRows.Close()

	// 为没有定义记录的网段补一个占位项（自动推导前缀与类别）
	for _, name := range statOrder {
		if _, ok := index[name]; ok {
			continue
		}
		v := IPSubnet{
			Name:     name,
			Category: "专网",
			Defined:  false,
		}
		if name == "外网" {
			v.Category = "外网"
		}
		var sample string
		if err := s.db.QueryRow(`SELECT ip FROM ip_pool WHERE subnet=? AND ip LIKE '%.%.%.%' ORDER BY id LIMIT 1`, name).Scan(&sample); err == nil {
			v.Prefix = ipPrefixOf(sample)
			if v.Prefix != "" {
				v.CIDR = v.Prefix + ".0/24"
			}
		}
		index[name] = len(out)
		out = append(out, v)
	}

	// 回填统计
	for name, st := range stats {
		if i, ok := index[name]; ok {
			out[i].Total = st.total
			out[i].Used = st.used
			out[i].Free = st.total - st.used
		}
	}

	// 按网段前缀自然排序（7 → 8 → 9 → 10 → 外网），尚未填写网段的排最后；
	// 与「网段总览」卡片顺序保持一致，避免「10段」排到「7段」前面。
	sort.SliceStable(out, func(i, j int) bool {
		pi, pj := out[i].Prefix, out[j].Prefix
		if pi == "" {
			return false
		}
		if pj == "" {
			return true
		}
		if vi, vj := ipPrefixValue(pi), ipPrefixValue(pj); vi != vj {
			return vi < vj
		}
		return out[i].SortOrder < out[j].SortOrder
	})
	return out, nil
}

// SeedIPSubnetsFromPool 为 ip_pool 中已存在但尚未定义的网段补建定义记录（幂等）。
func (s *Store) SeedIPSubnetsFromPool() (int, error) {
	list, err := s.ListIPSubnets()
	if err != nil {
		return 0, err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	added := 0
	order := 0
	for _, v := range list {
		if v.Defined {
			order++
			continue
		}
		cidr := v.CIDR
		if cidr == "" && v.Prefix != "" {
			cidr = v.Prefix + ".0/24"
		}
		_, err := s.db.Exec(`INSERT OR IGNORE INTO ip_subnets
			(name, category, prefix, cidr, sort_order, created_at, updated_at)
			VALUES (?,?,?,?,?,?,?)`, v.Name, v.Category, v.Prefix, cidr, order, now, now)
		if err != nil {
			return added, err
		}
		added++
		order++
	}
	return added, nil
}

func (s *Store) GetIPSubnet(id int64) (*IPSubnet, error) {
	var v IPSubnet
	err := s.db.QueryRow(`SELECT id, name, IFNULL(category,''), IFNULL(prefix,''), IFNULL(cidr,''),
		IFNULL(gateway,''), IFNULL(vlan,''), IFNULL(purpose,''), sort_order, IFNULL(remark,'')
		FROM ip_subnets WHERE id = ?`, id).
		Scan(&v.ID, &v.Name, &v.Category, &v.Prefix, &v.CIDR, &v.Gateway, &v.VLAN, &v.Purpose, &v.SortOrder, &v.Remark)
	if err != nil {
		return nil, err
	}
	v.Defined = true
	return &v, nil
}

func (s *Store) CreateIPSubnet(v *IPSubnet) (int64, error) {
	v.Name = strings.TrimSpace(v.Name)
	if v.Name == "" {
		return 0, fmt.Errorf("网段名称不能为空")
	}
	if strings.TrimSpace(v.Category) == "" {
		v.Category = "专网"
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`INSERT INTO ip_subnets
		(name, category, prefix, cidr, gateway, vlan, purpose, sort_order, remark, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		v.Name, v.Category, v.Prefix, v.CIDR, v.Gateway, v.VLAN, v.Purpose, v.SortOrder, v.Remark, now, now)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return 0, fmt.Errorf("网段「%s」已存在", v.Name)
		}
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateIPSubnet 更新网段定义；改名时级联更新 ip_pool.subnet，保证 IP 数据不断链。
func (s *Store) UpdateIPSubnet(v *IPSubnet) error {
	cur, err := s.GetIPSubnet(v.ID)
	if err != nil {
		return fmt.Errorf("网段不存在")
	}
	v.Name = strings.TrimSpace(v.Name)
	if v.Name == "" {
		return fmt.Errorf("网段名称不能为空")
	}
	if strings.TrimSpace(v.Category) == "" {
		v.Category = cur.Category
	}
	now := time.Now().Format("2006-01-02 15:04:05")

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if v.Name != cur.Name {
		var cnt int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM ip_subnets WHERE name = ? AND id <> ?`, v.Name, v.ID).Scan(&cnt); err != nil {
			return err
		}
		if cnt > 0 {
			return fmt.Errorf("网段「%s」已存在", v.Name)
		}
		// 级联：IP 数据按名称关联，改名必须同步过去
		if _, err := tx.Exec(`UPDATE ip_pool SET subnet = ? WHERE subnet = ?`, v.Name, cur.Name); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(`UPDATE ip_subnets SET name=?, category=?, prefix=?, cidr=?, gateway=?,
		vlan=?, purpose=?, sort_order=?, remark=?, updated_at=? WHERE id=?`,
		v.Name, v.Category, v.Prefix, v.CIDR, v.Gateway, v.VLAN, v.Purpose, v.SortOrder, v.Remark, now, v.ID); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteIPSubnet 删除网段定义。该网段下仍有 IP 数据时拒绝删除，避免产生无主 IP。
func (s *Store) DeleteIPSubnet(id int64) error {
	cur, err := s.GetIPSubnet(id)
	if err != nil {
		return fmt.Errorf("网段不存在")
	}
	var cnt int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM ip_pool WHERE subnet = ?`, cur.Name).Scan(&cnt); err != nil {
		return err
	}
	if cnt > 0 {
		return fmt.Errorf("网段「%s」下还有 %d 个 IP，请先转移或删除这些 IP", cur.Name, cnt)
	}
	res, err := s.db.Exec(`DELETE FROM ip_subnets WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("网段不存在")
	}
	return nil
}

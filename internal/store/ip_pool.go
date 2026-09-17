package store

import (
	"database/sql"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
)

// ============================ IP 池数据规范化 ============================

var (
	// 形如 "191.162.17.1 (盒子:180.161.30.1)"
	ipCompositeRe = regexp.MustCompile(`^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s*[（(]盒子[:：]\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})[）)]$`)
	// 从备注中取盒子地址（兼容 "盒子:1.2.3.4"、"盒子：1.2.3.4"、"盒子 1.2.3.4" 三种写法）
	ipBoxInRemarkRe = regexp.MustCompile(`盒子[:：]?\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})`)
	ipPlainRe       = regexp.MustCompile(`^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$`)
)

// BoxIPFromRemark 从备注里取出盒子地址；没有则返回空串。
func BoxIPFromRemark(remark string) string {
	m := ipBoxInRemarkRe.FindStringSubmatch(remark)
	if len(m) == 2 {
		return m[1]
	}
	return ""
}

// NormalizeIPPoolIPs 把历史迁移遗留的复合 IP 值规范为纯 IP：
//
//	"191.162.17.1 (盒子:180.161.30.1)"  ->  ip = "191.162.17.1"
//	                                        remark = "外网云桌面｜盒子 180.161.30.1"
//
// 盒子地址保留在备注中（ip_pool 表结构不可变更），供资产联动使用。
// 幂等：已是纯 IP 的行不会被再次处理。
func (s *Store) NormalizeIPPoolIPs() (int, error) {
	rows, err := s.db.Query(`SELECT id, ip, IFNULL(remark,'') FROM ip_pool`)
	if err != nil {
		return 0, err
	}
	type fix struct {
		id     int64
		ip     string
		remark string
	}
	var fixes []fix
	for rows.Next() {
		var id int64
		var ip, remark string
		if err := rows.Scan(&id, &ip, &remark); err != nil {
			rows.Close()
			return 0, err
		}
		if ipPlainRe.MatchString(ip) {
			continue // 已经是纯 IP
		}
		m := ipCompositeRe.FindStringSubmatch(ip)
		if len(m) != 3 {
			continue // 不符合已知的复合格式，不擅自改
		}
		newRemark := BoxIPFromRemark(remark)
		if newRemark == "" {
			if strings.TrimSpace(remark) == "" {
				remark = "盒子 " + m[2]
			} else {
				remark = remark + "｜盒子 " + m[2]
			}
		}
		fixes = append(fixes, fix{id: id, ip: m[1], remark: remark})
	}
	rows.Close()

	if len(fixes) == 0 {
		return 0, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	for _, f := range fixes {
		if _, err := tx.Exec(`UPDATE ip_pool SET ip=?, remark=? WHERE id=?`, f.ip, f.remark, f.id); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(fixes), nil
}

// ============================ 网段汇总 ============================

type IPSubnetSummary struct {
	Subnet    string  `json:"subnet"`
	Category  string  `json:"category"`
	Prefix    string  `json:"prefix"`
	CIDR      string  `json:"cidr"`
	RangeFrom string  `json:"range_from"`
	RangeTo   string  `json:"range_to"`
	Total     int     `json:"total"`
	Used      int     `json:"used"`
	Free      int     `json:"free"`
	UsageRate float64 `json:"usage_rate"`
}

type IPPoolSummary struct {
	Total     int               `json:"total"`
	Used      int               `json:"used"`
	Free      int               `json:"free"`
	UsageRate float64           `json:"usage_rate"`
	Subnets   []IPSubnetSummary `json:"subnets"`
}

// IPPoolSummaryData 按网段聚合 IP 容量与占用，全部基于全量数据（不是当前页）。
func (s *Store) IPPoolSummaryData() (*IPPoolSummary, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.IPPoolSummaryDataForProject(scope)
}

func (s *Store) IPPoolSummaryDataForProject(scope ProjectScope) (*IPPoolSummary, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT subnet, ip, status FROM ip_pool WHERE project_id=?`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type agg struct {
		total   int
		used    int
		prefix  string
		minLast int
		maxLast int
		hasLast bool
	}
	bySubnet := map[string]*agg{}
	var order []string

	for rows.Next() {
		var subnet, ip, status string
		if err := rows.Scan(&subnet, &ip, &status); err != nil {
			return nil, err
		}
		a := bySubnet[subnet]
		if a == nil {
			a = &agg{}
			bySubnet[subnet] = a
			order = append(order, subnet)
		}
		a.total++
		if status == "在用" {
			a.used++
		}
		if ipPlainRe.MatchString(ip) {
			idx := strings.LastIndex(ip, ".")
			a.prefix = ip[:idx]
			var last int
			fmt.Sscanf(ip[idx+1:], "%d", &last)
			if !a.hasLast {
				a.minLast, a.maxLast, a.hasLast = last, last, true
			} else {
				if last < a.minLast {
					a.minLast = last
				}
				if last > a.maxLast {
					a.maxLast = last
				}
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 按网段前缀的数值排序（138.64.7 < 138.64.8 < 138.64.9 < 138.64.10 < 191.162.17），
	// 避免字符串序把「10段」排到「7段」前面。
	sort.Slice(order, func(i, j int) bool {
		return ipPrefixValue(bySubnet[order[i]].prefix) < ipPrefixValue(bySubnet[order[j]].prefix)
	})
	out := &IPPoolSummary{Subnets: make([]IPSubnetSummary, 0, len(order))}
	for _, name := range order {
		a := bySubnet[name]
		free := a.total - a.used
		rate := 0.0
		if a.total > 0 {
			rate = math.Round(float64(a.used)/float64(a.total)*1000) / 10
		}
		item := IPSubnetSummary{
			Subnet: name, Prefix: a.prefix,
			Total: a.total, Used: a.used, Free: free, UsageRate: rate,
		}
		if a.hasLast {
			item.RangeFrom = fmt.Sprintf("%s.%d", a.prefix, a.minLast)
			item.RangeTo = fmt.Sprintf("%s.%d", a.prefix, a.maxLast)
		}
		out.Subnets = append(out.Subnets, item)
		out.Total += a.total
		out.Used += a.used
		out.Free += free
	}
	if out.Total > 0 {
		out.UsageRate = math.Round(float64(out.Used)/float64(out.Total)*1000) / 10
	}

	// 合并「网段定义」：补上类别 / CIDR，并让「已定义但暂无 IP」的网段也出现在总览里。
	defs, err := s.ListIPSubnets()
	if err != nil {
		return nil, err
	}
	pos := map[string]int{}
	for i, sub := range out.Subnets {
		pos[sub.Subnet] = i
	}
	for _, d := range defs {
		if i, ok := pos[d.Name]; ok {
			out.Subnets[i].Category = d.Category
			out.Subnets[i].CIDR = d.CIDR
			if out.Subnets[i].Prefix == "" {
				out.Subnets[i].Prefix = d.Prefix
			}
			continue
		}
		out.Subnets = append(out.Subnets, IPSubnetSummary{
			Subnet:   d.Name,
			Category: d.Category,
			Prefix:   d.Prefix,
			CIDR:     d.CIDR,
		})
	}
	// 无前缀的网段（尚未录入 IP）排到最后
	sort.SliceStable(out.Subnets, func(i, j int) bool {
		pi, pj := out.Subnets[i].Prefix, out.Subnets[j].Prefix
		if pi == "" {
			return false
		}
		if pj == "" {
			return true
		}
		return ipPrefixValue(pi) < ipPrefixValue(pj)
	})
	return out, nil
}

// ipPrefixValue 把 "138.64.7" 这类前缀转成可比较的整数值，用于网段自然排序。
func ipPrefixValue(prefix string) uint64 {
	parts := strings.Split(prefix, ".")
	var v uint64
	for i := 0; i < 4; i++ {
		var n uint64
		if i < len(parts) {
			fmt.Sscanf(parts[i], "%d", &n)
		}
		v = v<<8 | (n & 0xff)
	}
	return v
}

// ============================ 列表（含占用资产） ============================

type IPEntryQuery struct {
	Subnet   string
	Status   string
	Keyword  string
	Page     int
	PageSize int
}

// ipLastOctetOrder 按 IP 末位数值排序（字符串排序会把 .10 排到 .9 前面）。
const ipLastOctetOrder = `CAST(REPLACE(ip, rtrim(ip, '0123456789'), '') AS INTEGER)`

func (s *Store) buildIPWhere(q IPEntryQuery) (string, []interface{}) {
	var where []string
	var args []interface{}
	if sub := strings.TrimSpace(q.Subnet); sub != "" && sub != "全部" {
		where = append(where, "subnet = ?")
		args = append(args, sub)
	}
	if st := strings.TrimSpace(q.Status); st != "" && st != "全部" {
		where = append(where, "status = ?")
		args = append(args, st)
	}
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		pat := "%" + kw + "%"
		where = append(where, `(ip LIKE ? OR IFNULL(department,'') LIKE ? OR IFNULL(account,'') LIKE ?
			OR IFNULL(room,'') LIKE ? OR IFNULL(remark,'') LIKE ?)`)
		args = append(args, pat, pat, pat, pat, pat)
	}
	if len(where) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(where, " AND "), args
}

// QueryIPEntries 分页查询 IP 条目，并回填「占用资产」。
func (s *Store) QueryIPEntries(q IPEntryQuery) ([]IPEntry, int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, 0, err
	}
	return s.QueryIPEntriesForProject(scope, q)
}

func (s *Store) QueryIPEntriesForProject(scope ProjectScope, q IPEntryQuery) ([]IPEntry, int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, 0, err
	}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 || q.PageSize > 500 {
		q.PageSize = 100
	}
	where, args := s.buildIPWhereForProject(scope, q)

	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM ip_pool"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	query := `SELECT id, project_id, subnet, ip, IFNULL(department,''), IFNULL(room,''), IFNULL(account,''),
		IFNULL(status,''), IFNULL(remark,'') FROM ip_pool` + where +
		" ORDER BY subnet, " + ipLastOctetOrder + " LIMIT ? OFFSET ?"

	rows, err := s.db.Query(query, append(append([]interface{}{}, args...), q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	list := make([]IPEntry, 0, q.PageSize)
	for rows.Next() {
		var e IPEntry
		if err := rows.Scan(&e.ID, &e.ProjectID, &e.Subnet, &e.IP, &e.Department, &e.Room, &e.Account, &e.Status, &e.Remark); err != nil {
			return nil, 0, err
		}
		list = append(list, e)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	if err := s.attachIPOwnersForProject(scope, list); err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

func (s *Store) buildIPWhereForProject(scope ProjectScope, q IPEntryQuery) (string, []interface{}) {
	where, args := s.buildIPWhere(q)
	if where == "" {
		return " WHERE project_id=?", []interface{}{scope.ProjectID}
	}
	return " WHERE project_id=? AND " + strings.TrimPrefix(where, " WHERE "), append([]interface{}{scope.ProjectID}, args...)
}

// attachIPOwners 用 IP / 终端 IP 与资产台账做匹配，回填占用设备。
// 外网段额外用备注里的盒子地址参与匹配（资产的 terminal_ip 存的是盒子地址）。
func (s *Store) attachIPOwners(list []IPEntry) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.attachIPOwnersForProject(scope, list)
}

func (s *Store) attachIPOwnersForProject(scope ProjectScope, list []IPEntry) error {
	if len(list) == 0 {
		return nil
	}
	keyToIndex := map[string]int{}
	var cands []string
	for i, e := range list {
		for _, c := range []string{e.IP, BoxIPFromRemark(e.Remark)} {
			if c == "" {
				continue
			}
			if _, ok := keyToIndex[c]; !ok {
				keyToIndex[c] = i
				cands = append(cands, c)
			}
		}
	}
	if len(cands) == 0 {
		return nil
	}

	holders := make([]string, len(cands))
	args := make([]interface{}, 0, len(cands)*2)
	for i, c := range cands {
		holders[i] = "?"
		args = append(args, c)
	}
	inClause := strings.Join(holders, ",")
	q := `SELECT IFNULL(asset_code,''), IFNULL(user_name,''), IFNULL(ip,''), IFNULL(terminal_ip,'')
		FROM assets WHERE project_id=? AND (ip IN (` + inClause + `) OR terminal_ip IN (` + inClause + `))`
	args = append([]interface{}{scope.ProjectID}, append(args, args...)...)

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var code, user, ip, term string
		if err := rows.Scan(&code, &user, &ip, &term); err != nil {
			return err
		}
		for _, key := range []string{ip, term} {
			if idx, ok := keyToIndex[key]; ok {
				if list[idx].AssetCode == "" {
					list[idx].AssetCode = code
					list[idx].AssetUser = user
				}
			}
		}
	}
	return rows.Err()
}

// ============================ 写操作 ============================

func (s *Store) GetIPEntry(id int64) (*IPEntry, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.GetIPEntryForProject(scope, id)
}

func (s *Store) GetIPEntryForProject(scope ProjectScope, id int64) (*IPEntry, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	var e IPEntry
	err := s.db.QueryRow(`SELECT id, project_id, subnet, ip, IFNULL(department,''), IFNULL(room,''),
		IFNULL(account,''), IFNULL(status,''), IFNULL(remark,'') FROM ip_pool WHERE id = ? AND project_id=?`, id, scope.ProjectID).
		Scan(&e.ID, &e.ProjectID, &e.Subnet, &e.IP, &e.Department, &e.Room, &e.Account, &e.Status, &e.Remark)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func (s *Store) CreateIPEntry(e *IPEntry) (int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CreateIPEntryForProject(scope, e)
}

func (s *Store) CreateIPEntryForProject(scope ProjectScope, e *IPEntry) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if e == nil {
		return 0, fmt.Errorf("IP 条目不能为空")
	}
	e.IP = strings.TrimSpace(e.IP)
	e.Subnet = strings.TrimSpace(e.Subnet)
	if e.IP == "" {
		return 0, fmt.Errorf("IP 地址不能为空")
	}
	if !ipPlainRe.MatchString(e.IP) {
		return 0, fmt.Errorf("IP 地址格式不正确: %s", e.IP)
	}
	if e.Subnet == "" {
		return 0, fmt.Errorf("网段不能为空")
	}
	if e.Status == "" {
		e.Status = "空闲"
	}
	var cnt int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM ip_pool WHERE ip = ? AND project_id=?`, e.IP, scope.ProjectID).Scan(&cnt); err != nil {
		return 0, err
	}
	if cnt > 0 {
		return 0, fmt.Errorf("IP %s 已存在", e.IP)
	}
	res, err := s.db.Exec(`INSERT INTO ip_pool (project_id, subnet, ip, department, room, account, status, remark)
		VALUES (?,?,?,?,?,?,?,?)`, scope.ProjectID, e.Subnet, e.IP, e.Department, e.Room, e.Account, e.Status, e.Remark)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) UpdateIPEntry(e *IPEntry) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.UpdateIPEntryForProject(scope, e)
}

func (s *Store) UpdateIPEntryForProject(scope ProjectScope, e *IPEntry) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if e == nil {
		return fmt.Errorf("IP 条目不能为空")
	}
	if _, err := s.GetIPEntryForProject(scope, e.ID); err != nil {
		return fmt.Errorf("IP 条目不存在")
	}
	_, err := s.db.Exec(`UPDATE ip_pool SET subnet=?, ip=?, department=?, room=?, account=?, status=?, remark=?
		WHERE id=? AND project_id=?`, e.Subnet, e.IP, e.Department, e.Room, e.Account, e.Status, e.Remark, e.ID, scope.ProjectID)
	return err
}

// AllocateIP 分配一个 IP：置为「在用」并写入占用信息。
func (s *Store) AllocateIP(id int64, department, account, room, remark string) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.AllocateIPForProject(scope, id, department, account, room, remark)
}

func (s *Store) AllocateIPForProject(scope ProjectScope, id int64, department, account, room, remark string) error {
	cur, err := s.GetIPEntryForProject(scope, id)
	if err != nil {
		return fmt.Errorf("IP 条目不存在")
	}
	if cur.Status == "在用" {
		return fmt.Errorf("IP %s 已被占用，请先释放", cur.IP)
	}
	if strings.TrimSpace(account) == "" && strings.TrimSpace(department) == "" {
		return fmt.Errorf("请至少填写使用人或归属部门")
	}
	_, err = s.db.Exec(`UPDATE ip_pool SET status='在用', department=?, account=?, room=?, remark=? WHERE id=? AND project_id=?`,
		department, account, room, remark, id, scope.ProjectID)
	return err
}

// ReleaseIP 释放一个 IP：置回「空闲」并清空占用信息，保留 IP 与网段。
func (s *Store) ReleaseIP(id int64) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.ReleaseIPForProject(scope, id)
}

func (s *Store) ReleaseIPForProject(scope ProjectScope, id int64) error {
	cur, err := s.GetIPEntryForProject(scope, id)
	if err != nil {
		return fmt.Errorf("IP 条目不存在")
	}
	if cur.Status != "在用" {
		return fmt.Errorf("IP %s 当前不是占用状态，无需释放", cur.IP)
	}
	_, err = s.db.Exec(`UPDATE ip_pool SET status='空闲', department='', account='', room='', remark='' WHERE id=? AND project_id=?`, id, scope.ProjectID)
	return err
}

// ipOwner 返回占用该 IP 的资产编号与使用人（没有则返回空串）。
// 专网段按 IP 匹配；外网段额外用备注中的盒子地址匹配资产的 terminal_ip。
func (s *Store) ipOwner(e IPEntry) (string, string, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return "", "", err
	}
	return s.ipOwnerForProject(scope, e)
}

func (s *Store) ipOwnerForProject(scope ProjectScope, e IPEntry) (string, string, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return "", "", err
	}
	cands := []string{}
	if strings.TrimSpace(e.IP) != "" {
		cands = append(cands, e.IP)
	}
	if b := BoxIPFromRemark(e.Remark); b != "" {
		cands = append(cands, b)
	}
	if len(cands) == 0 {
		return "", "", nil
	}
	holders := make([]string, len(cands))
	args := make([]interface{}, 0, len(cands)*2)
	for i, c := range cands {
		holders[i] = "?"
		args = append(args, c)
	}
	inClause := strings.Join(holders, ",")
	args = append([]interface{}{scope.ProjectID}, append(args, args...)...)

	var code, user string
	err := s.db.QueryRow(`SELECT IFNULL(asset_code,''), IFNULL(user_name,'') FROM assets
		WHERE project_id=? AND (ip IN (`+inClause+`) OR terminal_ip IN (`+inClause+`)) LIMIT 1`, args...).Scan(&code, &user)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", "", nil
		}
		return "", "", err
	}
	return code, user, nil
}

// DeleteIPEntry 删除 IP 条目。
// 若该 IP 正被资产占用且未强制删除，则拒绝——删除不会动资产，
// 但会让「资产台账」与「IP 池」不一致，必须先由用户确认。
func (s *Store) DeleteIPEntry(id int64, force bool) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeleteIPEntryForProject(scope, id, force)
}

func (s *Store) DeleteIPEntryForProject(scope ProjectScope, id int64, force bool) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	cur, err := s.GetIPEntryForProject(scope, id)
	if err != nil {
		return fmt.Errorf("IP 条目不存在")
	}
	if !force {
		code, user, err := s.ipOwnerForProject(scope, *cur)
		if err != nil {
			return err
		}
		if code != "" {
			who := code
			if user != "" {
				who = code + "（" + user + "）"
			}
			return fmt.Errorf("该 IP 正被资产 %s 占用；删除只移除 IP 池记录、不会改动资产，会造成两边台账不一致。请改用「释放」，或先在资产中调整 IP 后再删除", who)
		}
	}
	res, err := s.db.Exec(`DELETE FROM ip_pool WHERE id=? AND project_id=?`, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("IP 条目不存在")
	}
	return nil
}

// IPEntryOwner 供接口层判断某个 IP 当前被哪台资产占用。
func (s *Store) IPEntryOwner(id int64) (string, string, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return "", "", err
	}
	return s.IPEntryOwnerForProject(scope, id)
}

func (s *Store) IPEntryOwnerForProject(scope ProjectScope, id int64) (string, string, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return "", "", err
	}
	cur, err := s.GetIPEntryForProject(scope, id)
	if err != nil {
		return "", "", err
	}
	return s.ipOwnerForProject(scope, *cur)
}

// AllIPEntries 返回当前筛选条件下的全部条目（用于导出，不受分页限制）。
func (s *Store) AllIPEntries(q IPEntryQuery) ([]IPEntry, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.AllIPEntriesForProject(scope, q)
}

func (s *Store) AllIPEntriesForProject(scope ProjectScope, q IPEntryQuery) ([]IPEntry, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	where, args := s.buildIPWhereForProject(scope, q)
	query := `SELECT id, project_id, subnet, ip, IFNULL(department,''), IFNULL(room,''), IFNULL(account,''),
		IFNULL(status,''), IFNULL(remark,'') FROM ip_pool` + where + " ORDER BY subnet, " + ipLastOctetOrder
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []IPEntry{}
	for rows.Next() {
		var e IPEntry
		if err := rows.Scan(&e.ID, &e.ProjectID, &e.Subnet, &e.IP, &e.Department, &e.Room, &e.Account, &e.Status, &e.Remark); err != nil {
			return nil, err
		}
		list = append(list, e)
	}
	return list, rows.Err()
}

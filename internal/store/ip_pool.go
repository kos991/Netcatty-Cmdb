package store

import (
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/netip"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
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
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.NormalizeIPPoolIPsForProject(scope)
}

func (s *Store) NormalizeIPPoolIPsForProject(scope ProjectScope) (int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	rows, err := s.db.Query(`SELECT id, ip, IFNULL(remark,'') FROM ip_pool WHERE project_id=?`, scope.ProjectID)
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
		if _, err := tx.Exec(`UPDATE ip_pool SET ip=?, remark=? WHERE id=? AND project_id=?`, f.ip, f.remark, f.id, scope.ProjectID); err != nil {
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
	VLAN      string  `json:"vlan"`
	VNI       string  `json:"vni"`
	Purpose   string  `json:"purpose"`
	RangeFrom string  `json:"range_from"`
	RangeTo   string  `json:"range_to"`
	Total     int     `json:"total"`
	Used      int     `json:"used"`
	Reserved  int     `json:"reserved"`
	Abnormal  int     `json:"abnormal"`
	Free      int     `json:"free"`
	UsageRate float64 `json:"usage_rate"`
}

type IPPoolSummary struct {
	Total     int               `json:"total"`
	Used      int               `json:"used"`
	Reserved  int               `json:"reserved"`
	Abnormal  int               `json:"abnormal"`
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
	defs, err := s.ListIPSubnetsForProject(scope)
	if err != nil {
		return nil, err
	}
	definedCIDR := make(map[string]string, len(defs))
	for _, def := range defs {
		if def.Defined {
			definedCIDR[def.Name] = normalizeSubnetCIDR(def.CIDR, def.Prefix)
		}
	}
	rows, err := s.db.Query(`SELECT id, project_id, subnet, ip, IFNULL(status,''),IFNULL(owner_type,''),IFNULL(owner_id,0),IFNULL(owner_name,'') FROM ip_pool WHERE project_id=?`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	entries := make([]IPEntry, 0)
	for rows.Next() {
		var entry IPEntry
		if err := rows.Scan(&entry.ID, &entry.ProjectID, &entry.Subnet, &entry.IP, &entry.Status, &entry.OwnerType, &entry.OwnerID, &entry.OwnerName); err != nil {
			rows.Close()
			return nil, err
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if err := s.attachIPOwnersForProject(scope, entries); err != nil {
		return nil, err
	}

	type agg struct {
		total    int
		used     int
		reserved int
		abnormal int
		prefix   string
		minLast  int
		maxLast  int
		hasLast  bool
	}
	bySubnet := map[string]*agg{}
	var order []string

	for _, entry := range entries {
		subnet, ip, status := entry.Subnet, entry.IP, entry.Status
		a := bySubnet[subnet]
		if a == nil {
			a = &agg{}
			bySubnet[subnet] = a
			order = append(order, subnet)
		}
		if specialIPv4Address(definedCIDR[subnet], ip) != "" {
			continue
		}
		a.total++
		if isIPUsedStatus(status) {
			a.used++
		} else if status == "保留" {
			a.reserved++
		} else if status == "不可用" || status == "冲突" || status == "异常" {
			a.abnormal++
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
	// 按网段前缀的数值排序（138.64.7 < 138.64.8 < 138.64.9 < 138.64.10 < 191.162.17），
	// 避免字符串序把「10段」排到「7段」前面。
	sort.Slice(order, func(i, j int) bool {
		return ipPrefixValue(bySubnet[order[i]].prefix) < ipPrefixValue(bySubnet[order[j]].prefix)
	})
	out := &IPPoolSummary{Subnets: make([]IPSubnetSummary, 0, len(order))}
	for _, name := range order {
		a := bySubnet[name]
		free := max(0, a.total-a.used-a.reserved-a.abnormal)
		rate := 0.0
		if a.total > 0 {
			rate = math.Round(float64(a.used)/float64(a.total)*1000) / 10
		}
		item := IPSubnetSummary{
			Subnet: name, Prefix: a.prefix,
			Total: a.total, Used: a.used, Reserved: a.reserved, Abnormal: a.abnormal, Free: free, UsageRate: rate,
		}
		if a.hasLast {
			item.RangeFrom = fmt.Sprintf("%s.%d", a.prefix, a.minLast)
			item.RangeTo = fmt.Sprintf("%s.%d", a.prefix, a.maxLast)
		}
		out.Subnets = append(out.Subnets, item)
		out.Total += a.total
		out.Used += a.used
		out.Reserved += a.reserved
		out.Abnormal += a.abnormal
		out.Free += free
	}
	if out.Total > 0 {
		out.UsageRate = math.Round(float64(out.Used)/float64(out.Total)*1000) / 10
	}

	// 合并「网段定义」：补上类别 / CIDR，并让「已定义但暂无 IP」的网段也出现在总览里。
	pos := map[string]int{}
	for i, sub := range out.Subnets {
		pos[sub.Subnet] = i
	}
	for _, d := range defs {
		if i, ok := pos[d.Name]; ok {
			out.Subnets[i].Category = d.Category
			out.Subnets[i].CIDR = d.CIDR
			out.Subnets[i].VLAN = d.VLAN
			out.Subnets[i].VNI = d.VNI
			out.Subnets[i].Purpose = d.Purpose
			if out.Subnets[i].Prefix == "" {
				out.Subnets[i].Prefix = d.Prefix
			}
			if capacity, first, last, ok := usableIPv4Range(normalizeSubnetCIDR(d.CIDR, d.Prefix)); d.Defined && ok {
				previousTotal := out.Subnets[i].Total
				previousFree := out.Subnets[i].Free
				out.Subnets[i].Total = capacity
				out.Subnets[i].Free = max(0, capacity-out.Subnets[i].Used-out.Subnets[i].Reserved-out.Subnets[i].Abnormal)
				out.Subnets[i].UsageRate = usageRate(out.Subnets[i].Used, capacity)
				out.Subnets[i].RangeFrom, out.Subnets[i].RangeTo = first.String(), last.String()
				out.Total += capacity - previousTotal
				out.Free += out.Subnets[i].Free - previousFree
			}
			continue
		}
		item := IPSubnetSummary{
			Subnet:   d.Name,
			Category: d.Category,
			Prefix:   d.Prefix,
			CIDR:     d.CIDR,
			VLAN:     d.VLAN,
			VNI:      d.VNI,
			Purpose:  d.Purpose,
		}
		if capacity, first, last, ok := usableIPv4Range(normalizeSubnetCIDR(d.CIDR, d.Prefix)); d.Defined && ok {
			item.Total, item.Free = capacity, capacity
			item.RangeFrom, item.RangeTo = first.String(), last.String()
			out.Total += capacity
			out.Free += capacity
		}
		out.Subnets = append(out.Subnets, item)
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
	out.UsageRate = usageRate(out.Used, out.Total)
	return out, nil
}

func usageRate(used, total int) float64 {
	if total <= 0 {
		return 0
	}
	return math.Round(float64(used)/float64(total)*1000) / 10
}

func isIPUsedStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "在用", "已占用", "已分配", "占用":
		return true
	default:
		return false
	}
}

func usableIPv4Range(cidr string) (int, netip.Addr, netip.Addr, bool) {
	prefix, err := netip.ParsePrefix(strings.TrimSpace(cidr))
	if err != nil || !prefix.Addr().Is4() {
		return 0, netip.Addr{}, netip.Addr{}, false
	}
	prefix = prefix.Masked()
	capacity := uint64(1) << uint(32-prefix.Bits())
	first := prefix.Addr()
	if prefix.Bits() <= 30 {
		capacity -= 2
		first = first.Next()
	}
	if capacity > uint64(^uint(0)>>1) {
		return 0, netip.Addr{}, netip.Addr{}, false
	}
	last := addIPv4(first, uint32(capacity-1))
	return int(capacity), first, last, true
}

func specialIPv4Address(cidr, ip string) string {
	prefix, err := netip.ParsePrefix(strings.TrimSpace(cidr))
	if err != nil || !prefix.Addr().Is4() || prefix.Bits() > 30 {
		return ""
	}
	addr, err := netip.ParseAddr(strings.TrimSpace(ip))
	if err != nil || !addr.Is4() || !prefix.Contains(addr) {
		return ""
	}
	prefix = prefix.Masked()
	if addr == prefix.Addr() {
		return "网络地址"
	}
	last := addIPv4(prefix.Addr(), uint32((uint64(1)<<uint(32-prefix.Bits()))-1))
	if addr == last {
		return "广播地址"
	}
	return ""
}

func (s *Store) ensureAssignableIPForProject(scope ProjectScope, subnet, ip string) error {
	return ensureAssignableIP(s.db, scope, subnet, ip)
}

func ensureAssignableIP(q interface{ QueryRow(string, ...any) *sql.Row }, scope ProjectScope, subnet, ip string) error {
	var cidr, prefix string
	err := q.QueryRow(`SELECT IFNULL(cidr,''),IFNULL(prefix,'') FROM ip_subnets WHERE project_id=? AND name=? AND deleted_at IS NULL`, scope.ProjectID, subnet).Scan(&cidr, &prefix)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if kind := specialIPv4Address(normalizeSubnetCIDR(cidr, prefix), ip); kind != "" {
		return fmt.Errorf("%s 是%s，不能预留或分配", ip, kind)
	}
	return nil
}

func ensureHostIPInDefinedSubnets(q interface {
	Query(string, ...any) (*sql.Rows, error)
}, projectID int64, ip string) error {
	rows, err := q.Query(`SELECT name,IFNULL(cidr,''),IFNULL(prefix,'') FROM ip_subnets WHERE project_id=? AND deleted_at IS NULL`, projectID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var name, cidr, prefix string
		if err := rows.Scan(&name, &cidr, &prefix); err != nil {
			return err
		}
		if kind := specialIPv4Address(normalizeSubnetCIDR(cidr, prefix), ip); kind != "" {
			return fmt.Errorf("%s 是网段「%s」的%s，不能分配给资产", ip, name, kind)
		}
	}
	return rows.Err()
}

func normalizeSubnetCIDR(cidr, prefix string) string {
	cidr, prefix = strings.TrimSpace(cidr), strings.TrimSpace(prefix)
	if cidr == "" && strings.Contains(prefix, "/") {
		return prefix
	}
	bitsText := strings.TrimPrefix(cidr, "/")
	bits, err := strconv.Atoi(bitsText)
	if err != nil || bits < 0 || bits > 32 || prefix == "" {
		return cidr
	}
	base := prefix
	if strings.Count(base, ".") == 2 {
		base += ".0"
	}
	return base + "/" + strconv.Itoa(bits)
}

func addIPv4(addr netip.Addr, delta uint32) netip.Addr {
	b := addr.As4()
	value := uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])
	value += delta
	return netip.AddrFrom4([4]byte{byte(value >> 24), byte(value >> 16), byte(value >> 8), byte(value)})
}

// VisualizeIPSubnet 返回完整地址方格；网络和广播地址只读，不占用可分配容量。
func (s *Store) VisualizeIPSubnet(subnet string, page, pageSize int) ([]IPEntry, int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, 0, err
	}
	return s.VisualizeIPSubnetForProject(scope, subnet, page, pageSize)
}

func (s *Store) VisualizeIPSubnetForProject(scope ProjectScope, subnet string, page, pageSize int) ([]IPEntry, int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, 0, err
	}
	subnet = strings.TrimSpace(subnet)
	var cidr, prefix string
	err := s.db.QueryRow(`SELECT IFNULL(cidr,''),IFNULL(prefix,'') FROM ip_subnets WHERE project_id=? AND name=?`, scope.ProjectID, subnet).Scan(&cidr, &prefix)
	if err == sql.ErrNoRows {
		return nil, 0, fmt.Errorf("网段「%s」尚未定义 CIDR", subnet)
	}
	if err != nil {
		return nil, 0, err
	}
	fullCIDR := normalizeSubnetCIDR(cidr, prefix)
	usable, first, _, ok := usableIPv4Range(fullCIDR)
	if !ok {
		return nil, 0, fmt.Errorf("网段「%s」的 CIDR 无效或没有可用主机地址", subnet)
	}
	parsed, _ := netip.ParsePrefix(fullCIDR)
	total := usable
	if parsed.Bits() <= 30 {
		first = parsed.Masked().Addr()
		total += 2
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize
	if offset >= total {
		return []IPEntry{}, total, nil
	}
	limit := min(pageSize, total-offset)
	rows := make([]IPEntry, 0, limit)
	addr := first
	for i := 0; i < offset; i++ {
		addr = addr.Next()
	}
	for i := 0; i < limit; i++ {
		status := specialIPv4Address(fullCIDR, addr.String())
		if status == "" {
			status = "空闲"
		}
		rows = append(rows, IPEntry{ProjectID: scope.ProjectID, Subnet: subnet, IP: addr.String(), Status: status})
		addr = addr.Next()
	}

	dbRows, err := s.db.Query(`SELECT id,project_id,subnet,ip,IFNULL(department,''),IFNULL(room,''),IFNULL(account,''),IFNULL(status,''),IFNULL(remark,''),IFNULL(owner_type,''),IFNULL(owner_id,0),IFNULL(owner_name,'')
		FROM ip_pool WHERE project_id=? AND subnet=?`, scope.ProjectID, subnet)
	if err != nil {
		return nil, 0, err
	}
	defer dbRows.Close()
	byIP := make(map[string]IPEntry)
	for dbRows.Next() {
		var entry IPEntry
		if err := dbRows.Scan(&entry.ID, &entry.ProjectID, &entry.Subnet, &entry.IP, &entry.Department, &entry.Room, &entry.Account, &entry.Status, &entry.Remark, &entry.OwnerType, &entry.OwnerID, &entry.OwnerName); err != nil {
			return nil, 0, err
		}
		byIP[entry.IP] = entry
	}
	if err := dbRows.Err(); err != nil {
		return nil, 0, err
	}
	for i := range rows {
		if entry, exists := byIP[rows[i].IP]; exists {
			rows[i] = entry
		}
		if kind := specialIPv4Address(fullCIDR, rows[i].IP); kind != "" {
			rows[i].Status = kind
		}
	}
	if err := s.attachIPOwnersForProject(scope, rows); err != nil {
		return nil, 0, err
	}
	for i := range rows {
		if kind := specialIPv4Address(fullCIDR, rows[i].IP); kind != "" {
			rows[i].Status = kind
		}
	}
	return rows, total, nil
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
		IFNULL(status,''), IFNULL(remark,''),IFNULL(owner_type,''),IFNULL(owner_id,0),IFNULL(owner_name,'') FROM ip_pool` + where +
		" ORDER BY subnet, " + ipLastOctetOrder + " LIMIT ? OFFSET ?"

	rows, err := s.db.Query(query, append(append([]interface{}{}, args...), q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	list := make([]IPEntry, 0, q.PageSize)
	for rows.Next() {
		var e IPEntry
		if err := rows.Scan(&e.ID, &e.ProjectID, &e.Subnet, &e.IP, &e.Department, &e.Room, &e.Account, &e.Status, &e.Remark, &e.OwnerType, &e.OwnerID, &e.OwnerName); err != nil {
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
	keyToIndexes := map[string][]int{}
	var cands []string
	for i, e := range list {
		for _, c := range []string{e.IP, BoxIPFromRemark(e.Remark)} {
			if c == "" {
				continue
			}
			if _, ok := keyToIndexes[c]; !ok {
				cands = append(cands, c)
			}
			keyToIndexes[c] = append(keyToIndexes[c], i)
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
	apply := func(key, ownerType string, ownerID int64, ownerName, code, user, department, room string) {
		for _, idx := range keyToIndexes[key] {
			if list[idx].OwnerType != "" {
				continue
			}
			list[idx].Status = "在用"
			list[idx].OwnerType = ownerType
			list[idx].OwnerID = ownerID
			list[idx].OwnerName = ownerName
			list[idx].AssetCode = code
			list[idx].AssetUser = user
			if list[idx].Account == "" {
				list[idx].Account = user
			}
			if list[idx].Department == "" {
				list[idx].Department = department
			}
			if list[idx].Room == "" {
				list[idx].Room = room
			}
		}
	}
	queryArgs := func(repeats int) []interface{} {
		out := []interface{}{scope.ProjectID}
		for i := 0; i < repeats; i++ {
			for _, candidate := range cands {
				out = append(out, candidate)
			}
		}
		return out
	}

	// 业务系统优先于承载设备显示；同一个服务器地址承载应用时，IPAM 应明确标记为应用占用。
	rows, err := s.db.Query(`SELECT app.id, IFNULL(app.app_name,''), IFNULL(app.owner,''), IFNULL(srv.asset_code,''), IFNULL(srv.location,''), IFNULL(srv.biz_ip,''), IFNULL(srv.mgmt_ip,'')
		FROM server_apps app JOIN servers srv ON srv.id=app.server_id AND srv.project_id=app.project_id
		WHERE app.project_id=? AND (srv.biz_ip IN (`+inClause+`) OR srv.mgmt_ip IN (`+inClause+`))`, queryArgs(2)...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		var name, user, code, room, bizIP, mgmtIP string
		if err := rows.Scan(&id, &name, &user, &code, &room, &bizIP, &mgmtIP); err != nil {
			rows.Close()
			return err
		}
		for _, key := range []string{bizIP, mgmtIP} {
			apply(key, "application", id, name, code, user, "", room)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	rows, err = s.db.Query(`SELECT DISTINCT a.id, IFNULL(a.name,''), IFNULL(a.asset_code,''), IFNULL(a.owner,''), IFNULL(a.department,''), IFNULL(a.room,''),
		IFNULL(a.mgmt_ip,''), IFNULL(a.manage_ip,''), IFNULL(a.biz_ip,''), IFNULL(a.public_ip,''), IFNULL(i.ip,'')
		FROM cmdb_assets a LEFT JOIN cmdb_asset_interfaces i ON i.asset_id=a.id AND i.project_id=a.project_id
		WHERE a.project_id=? AND a.deleted_at IS NULL AND (a.mgmt_ip IN (`+inClause+`) OR a.manage_ip IN (`+inClause+`)
			OR a.biz_ip IN (`+inClause+`) OR a.public_ip IN (`+inClause+`) OR i.ip IN (`+inClause+`))`, queryArgs(5)...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		var name, code, user, department, room, mgmtIP, manageIP, bizIP, publicIP, interfaceIP string
		if err := rows.Scan(&id, &name, &code, &user, &department, &room, &mgmtIP, &manageIP, &bizIP, &publicIP, &interfaceIP); err != nil {
			rows.Close()
			return err
		}
		for _, key := range []string{mgmtIP, manageIP, bizIP, publicIP, interfaceIP} {
			apply(key, "infrastructure", id, name, code, user, department, room)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	rows, err = s.db.Query(`SELECT id, IFNULL(device_name,''), IFNULL(asset_code,''), IFNULL(admin_user,''), IFNULL(location,''), IFNULL(biz_ip,''), IFNULL(mgmt_ip,'')
		FROM servers WHERE project_id=? AND (biz_ip IN (`+inClause+`) OR mgmt_ip IN (`+inClause+`))`, queryArgs(2)...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		var name, code, user, room, bizIP, mgmtIP string
		if err := rows.Scan(&id, &name, &code, &user, &room, &bizIP, &mgmtIP); err != nil {
			rows.Close()
			return err
		}
		for _, key := range []string{bizIP, mgmtIP} {
			apply(key, "server", id, name, code, user, "", room)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	rows, err = s.db.Query(`SELECT id, IFNULL(asset_code,''), IFNULL(user_name,''), IFNULL(department,''), IFNULL(room,''), IFNULL(ip,''), IFNULL(terminal_ip,'')
		FROM assets WHERE project_id=? AND (ip IN (`+inClause+`) OR terminal_ip IN (`+inClause+`))`, queryArgs(2)...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		var code, user, department, room, ip, term string
		if err := rows.Scan(&id, &code, &user, &department, &room, &ip, &term); err != nil {
			rows.Close()
			return err
		}
		for _, key := range []string{ip, term} {
			apply(key, "terminal", id, code, code, user, department, room)
		}
	}
	err = rows.Err()
	rows.Close()
	return err
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
		IFNULL(account,''), IFNULL(status,''), IFNULL(remark,''),IFNULL(owner_type,''),IFNULL(owner_id,0),IFNULL(owner_name,'') FROM ip_pool WHERE id = ? AND project_id=?`, id, scope.ProjectID).
		Scan(&e.ID, &e.ProjectID, &e.Subnet, &e.IP, &e.Department, &e.Room, &e.Account, &e.Status, &e.Remark, &e.OwnerType, &e.OwnerID, &e.OwnerName)
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
	if err := s.ensureAssignableIPForProject(scope, e.Subnet, e.IP); err != nil {
		return 0, err
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
	ownerProbe := []IPEntry{*e}
	if err := s.attachIPOwnersForProject(scope, ownerProbe); err != nil {
		return 0, err
	}
	if ownerProbe[0].OwnerType != "" {
		e.Status = "在用"
		e.Account = ownerProbe[0].AssetUser
		e.Department = ownerProbe[0].Department
		e.Room = ownerProbe[0].Room
		e.AssetCode = ownerProbe[0].AssetCode
		e.AssetUser = ownerProbe[0].AssetUser
		e.OwnerType = ownerProbe[0].OwnerType
		e.OwnerID = ownerProbe[0].OwnerID
		e.OwnerName = ownerProbe[0].OwnerName
	}
	res, err := s.db.Exec(`INSERT INTO ip_pool (project_id, subnet, ip, department, room, account, status, remark,owner_type,owner_id,owner_name)
		VALUES (?,?,?,?,?,?,?,?,?,?,?)`, scope.ProjectID, e.Subnet, e.IP, e.Department, e.Room, e.Account, e.Status, e.Remark, e.OwnerType, e.OwnerID, e.OwnerName)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ImportIPEntriesForProject 在同一事务中导入 IPAM 条目，任一重复或无效值都会整体回滚。
func (s *Store) ImportIPEntriesForProject(scope ProjectScope, entries []IPEntry) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	for index := range entries {
		e := &entries[index]
		e.IP, e.Subnet = strings.TrimSpace(e.IP), strings.TrimSpace(e.Subnet)
		if e.IP == "" || !ipPlainRe.MatchString(e.IP) {
			return fmt.Errorf("第 %d 条 IP 地址格式不正确: %s", index+1, e.IP)
		}
		if e.Subnet == "" {
			return fmt.Errorf("第 %d 条网段不能为空", index+1)
		}
		if err := s.ensureAssignableIPForProject(scope, e.Subnet, e.IP); err != nil {
			return fmt.Errorf("第 %d 条: %w", index+1, err)
		}
		if e.Status == "" {
			e.Status = "空闲"
		}
	}
	if err := s.attachIPOwnersForProject(scope, entries); err != nil {
		return err
	}
	for index := range entries {
		e := &entries[index]
		if e.OwnerType == "" {
			continue
		}
		e.Status = "在用"
		e.Account = e.AssetUser
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for index := range entries {
		e := &entries[index]
		var count int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM ip_pool WHERE project_id=? AND ip=?`, scope.ProjectID, e.IP).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			return fmt.Errorf("IP %s 已存在", e.IP)
		}
		if _, err := tx.Exec(`INSERT INTO ip_pool(project_id,subnet,ip,department,room,account,status,remark,owner_type,owner_id,owner_name) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
			scope.ProjectID, e.Subnet, e.IP, e.Department, e.Room, e.Account, e.Status, e.Remark, e.OwnerType, e.OwnerID, e.OwnerName); err != nil {
			return err
		}
	}
	return tx.Commit()
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
	cur, err := s.GetIPEntryForProject(scope, e.ID)
	if err != nil {
		return fmt.Errorf("IP 条目不存在")
	}
	if err := s.ensureAssignableIPForProject(scope, e.Subnet, e.IP); err != nil {
		return err
	}
	if (isIPUsedStatus(cur.Status) || cur.OwnerType != "") && !isIPUsedStatus(e.Status) {
		return fmt.Errorf("IP %s 已被占用，请先释放", cur.IP)
	}
	_, err = s.db.Exec(`UPDATE ip_pool SET subnet=?, ip=?, department=?, room=?, account=?, status=?, remark=?,owner_type=?,owner_id=?,owner_name=?
		WHERE id=? AND project_id=?`, e.Subnet, e.IP, e.Department, e.Room, e.Account, e.Status, e.Remark, e.OwnerType, e.OwnerID, e.OwnerName, e.ID, scope.ProjectID)
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
	if err := s.ensureAssignableIPForProject(scope, cur.Subnet, cur.IP); err != nil {
		return err
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

func (s *Store) AllocateIPToAsset(id, assetID int64, field, remark string) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.AllocateIPToAssetForProject(scope, id, assetID, field, remark)
}

func (s *Store) AllocateIPToOwnerForProject(scope ProjectScope, id int64, ownerType string, ownerID int64, field, remark string) error {
	if ownerType == "terminal" || ownerType == "" {
		if err := s.AllocateIPToAssetForProject(scope, id, ownerID, field, remark); err != nil {
			return err
		}
		var name string
		_ = s.db.QueryRow(`SELECT COALESCE(NULLIF(asset_code,''),NULLIF(device_type,''),'终端资产') FROM assets WHERE project_id=? AND id=?`, scope.ProjectID, ownerID).Scan(&name)
		_, err := s.db.Exec(`UPDATE ip_pool SET owner_type='terminal',owner_id=?,owner_name=? WHERE project_id=? AND id=?`, ownerID, name, scope.ProjectID, id)
		return err
	}
	if ownerID <= 0 {
		return errors.New("关联对象 ID 无效")
	}
	cur, err := s.GetIPEntryForProject(scope, id)
	if err != nil {
		return fmt.Errorf("IP 条目不存在")
	}
	if err := s.ensureAssignableIPForProject(scope, cur.Subnet, cur.IP); err != nil {
		return err
	}
	if cur.Status == "在用" {
		return fmt.Errorf("IP %s 已被占用，请先释放", cur.IP)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var name, account, department, room string
	switch ownerType {
	case "infrastructure":
		if field == "" {
			field = "mgmt_ip"
		}
		if field != "mgmt_ip" && field != "biz_ip" && field != "public_ip" {
			return errors.New("基础设施 IP 用途无效")
		}
		if err := tx.QueryRow(`SELECT name,IFNULL(owner,''),IFNULL(department,''),IFNULL(room,'') FROM cmdb_assets WHERE project_id=? AND id=? AND deleted_at IS NULL`, scope.ProjectID, ownerID).Scan(&name, &account, &department, &room); err != nil {
			return fmt.Errorf("基础设施不存在")
		}
		column := field
		if _, err := tx.Exec(`UPDATE cmdb_assets SET `+column+`=?,manage_ip=CASE WHEN ?='mgmt_ip' THEN ? ELSE manage_ip END,updated_at=? WHERE project_id=? AND id=?`, cur.IP, field, cur.IP, time.Now().Format("2006-01-02 15:04:05"), scope.ProjectID, ownerID); err != nil {
			return err
		}
	case "application":
		if err := tx.QueryRow(`SELECT app_name,IFNULL(owner,'') FROM server_apps WHERE project_id=? AND id=?`, scope.ProjectID, ownerID).Scan(&name, &account); err != nil {
			return fmt.Errorf("业务系统不存在")
		}
	default:
		return fmt.Errorf("不支持的占用对象类型: %s", ownerType)
	}
	if _, err := tx.Exec(`UPDATE ip_pool SET status='在用',department=?,account=?,room=?,remark=?,owner_type=?,owner_id=?,owner_name=? WHERE project_id=? AND id=?`, department, account, room, remark, ownerType, ownerID, name, scope.ProjectID, id); err != nil {
		return err
	}
	return tx.Commit()
}

// AllocateIPToAssetForProject 在一个事务中同步资产与 IP 池，人员、部门和位置以资产台账为准。
func (s *Store) AllocateIPToAssetForProject(scope ProjectScope, id, assetID int64, field, remark string) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if field != "ip" && field != "terminal_ip" {
		return fmt.Errorf("IP 用途无效")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var entry IPEntry
	if err := tx.QueryRow(`SELECT id,project_id,subnet,ip,IFNULL(status,''),IFNULL(remark,'') FROM ip_pool WHERE id=? AND project_id=?`, id, scope.ProjectID).
		Scan(&entry.ID, &entry.ProjectID, &entry.Subnet, &entry.IP, &entry.Status, &entry.Remark); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("IP 条目不存在")
		}
		return err
	}
	if err := ensureAssignableIP(tx, scope, entry.Subnet, entry.IP); err != nil {
		return err
	}
	if entry.Status == "在用" {
		return fmt.Errorf("IP %s 已被占用，请先释放", entry.IP)
	}
	var asset Asset
	if err := tx.QueryRow(`SELECT id,IFNULL(device_type,''),IFNULL(user_name,''),IFNULL(department,''),IFNULL(room,''),IFNULL(ip,''),IFNULL(terminal_ip,'') FROM assets WHERE id=? AND project_id=?`, assetID, scope.ProjectID).
		Scan(&asset.ID, &asset.DeviceType, &asset.UserName, &asset.Department, &asset.Room, &asset.IP, &asset.TerminalIP); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("资产不存在")
		}
		return err
	}
	if field == "terminal_ip" && !isCloudDesktopDeviceType(asset.DeviceType) {
		return fmt.Errorf("仅云桌面类设备可以分配终端物理 IP")
	}
	var conflicts int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM assets WHERE project_id=? AND id<>? AND (ip=? OR terminal_ip=?)`, scope.ProjectID, assetID, entry.IP, entry.IP).Scan(&conflicts); err != nil {
		return err
	}
	if conflicts > 0 {
		return fmt.Errorf("IP %s 已关联其他资产", entry.IP)
	}
	oldIP := asset.IP
	if field == "terminal_ip" {
		oldIP = asset.TerminalIP
	}
	column := "ip"
	if field == "terminal_ip" {
		column = "terminal_ip"
	}
	if _, err := tx.Exec(`UPDATE assets SET `+column+`=?,updated_at=? WHERE id=? AND project_id=?`, entry.IP, time.Now().Format("2006-01-02 15:04:05"), assetID, scope.ProjectID); err != nil {
		return err
	}
	if oldIP != "" && oldIP != entry.IP {
		if err := releaseUnreferencedIPInTx(tx, scope.ProjectID, oldIP); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE ip_pool SET status='在用',department=?,account=?,room=?,remark=? WHERE id=? AND project_id=?`, asset.Department, asset.UserName, asset.Room, remark, id, scope.ProjectID); err != nil {
		return err
	}
	return tx.Commit()
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
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if cur.OwnerType == "infrastructure" && cur.OwnerID > 0 {
		if _, err := tx.Exec(`UPDATE cmdb_assets SET mgmt_ip=CASE WHEN mgmt_ip=? THEN '' ELSE mgmt_ip END,manage_ip=CASE WHEN manage_ip=? THEN '' ELSE manage_ip END,biz_ip=CASE WHEN biz_ip=? THEN '' ELSE biz_ip END,public_ip=CASE WHEN public_ip=? THEN '' ELSE public_ip END,updated_at=? WHERE project_id=? AND id=?`, cur.IP, cur.IP, cur.IP, cur.IP, time.Now().Format("2006-01-02 15:04:05"), scope.ProjectID, cur.OwnerID); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE cmdb_asset_interfaces SET ip='' WHERE project_id=? AND asset_id=? AND ip=?`, scope.ProjectID, cur.OwnerID, cur.IP); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE assets SET ip=CASE WHEN ip=? THEN '' ELSE ip END, terminal_ip=CASE WHEN terminal_ip=? THEN '' ELSE terminal_ip END, updated_at=? WHERE project_id=? AND (ip=? OR terminal_ip=?)`, cur.IP, cur.IP, time.Now().Format("2006-01-02 15:04:05"), scope.ProjectID, cur.IP, cur.IP); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE ip_pool SET status='空闲', department='', account='', room='', remark='',owner_type='',owner_id=0,owner_name='' WHERE id=? AND project_id=?`, id, scope.ProjectID); err != nil {
		return err
	}
	return tx.Commit()
}

func releaseUnreferencedIPInTx(tx *sql.Tx, projectID int64, ip string) error {
	if strings.TrimSpace(ip) == "" {
		return nil
	}
	var references int
	if err := tx.QueryRow(`SELECT
		(SELECT COUNT(*) FROM assets WHERE project_id=? AND (ip=? OR terminal_ip=?)) +
		(SELECT COUNT(*) FROM cmdb_assets WHERE project_id=? AND deleted_at IS NULL AND (mgmt_ip=? OR manage_ip=? OR biz_ip=? OR public_ip=?)) +
		(SELECT COUNT(*) FROM cmdb_asset_interfaces WHERE project_id=? AND ip=?) +
		(SELECT COUNT(*) FROM servers WHERE project_id=? AND (mgmt_ip=? OR biz_ip=?))`,
		projectID, ip, ip,
		projectID, ip, ip, ip, ip,
		projectID, ip,
		projectID, ip, ip,
	).Scan(&references); err != nil {
		return err
	}
	if references == 0 {
		_, err := tx.Exec(`UPDATE ip_pool SET status='空闲',department='',account='',room='',remark='',owner_type='',owner_id=0,owner_name='' WHERE project_id=? AND ip=?`, projectID, ip)
		return err
	}
	return nil
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
		owners := []IPEntry{*cur}
		if err := s.attachIPOwnersForProject(scope, owners); err != nil {
			return err
		}
		owner := owners[0]
		if owner.OwnerType != "" {
			who := strings.TrimSpace(owner.OwnerName)
			if who == "" {
				who = strings.TrimSpace(owner.AssetCode)
			}
			if who == "" {
				who = fmt.Sprintf("%s #%d", owner.OwnerType, owner.OwnerID)
			}
			if owner.AssetUser != "" && owner.AssetUser != who {
				who += "（" + owner.AssetUser + "）"
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
		IFNULL(status,''), IFNULL(remark,''),IFNULL(owner_type,''),IFNULL(owner_id,0),IFNULL(owner_name,'') FROM ip_pool` + where + " ORDER BY subnet, " + ipLastOctetOrder
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []IPEntry{}
	for rows.Next() {
		var e IPEntry
		if err := rows.Scan(&e.ID, &e.ProjectID, &e.Subnet, &e.IP, &e.Department, &e.Room, &e.Account, &e.Status, &e.Remark, &e.OwnerType, &e.OwnerID, &e.OwnerName); err != nil {
			return nil, err
		}
		list = append(list, e)
	}
	return list, rows.Err()
}
